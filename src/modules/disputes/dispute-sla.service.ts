import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DisputeSlaStatus, DisputeStage, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SystemConfigService } from '../../common/system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ACTIVE_DISPUTE_STATUSES } from './dispute.constants';
import { DistributedLockService } from '../../common/lock/distributed-lock.service';

/** Runtime-tunable SLA settings per stage (#503). */
const STAGE_SYSTEM_CONFIG_KEYS: Record<DisputeStage, string> = {
  [DisputeStage.ASSIGNMENT]: 'disputes.slaAssignmentHours',
  [DisputeStage.ARBITER_REVIEW]: 'disputes.slaReviewHours',
  [DisputeStage.APPEAL_REVIEW]: 'disputes.slaAppealHours',
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * DisputeSlaService (#381)
 *
 * Every dispute stage carries a response deadline:
 *   - ASSIGNMENT      — an admin must assign an arbiter (DISPUTE_SLA_ASSIGNMENT_HOURS, default 24h)
 *   - ARBITER_REVIEW  — the arbiter must decide (DISPUTE_SLA_REVIEW_HOURS, default 72h)
 *   - APPEAL_REVIEW   — the appeal arbiter must decide (DISPUTE_SLA_APPEAL_HOURS, default 72h)
 *
 * A job runs every 10 minutes, flags disputes past their deadline as OVERDUE and
 * notifies every active admin once per stage (tracked via slaEscalatedAt).
 */
@Injectable()
export class DisputeSlaService {
  private readonly logger = new Logger(DisputeSlaService.name);
  private readonly stageHours: Record<DisputeStage, number>;
  private readonly evidenceWarningHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly lock: DistributedLockService,
    @Optional() private readonly systemConfig?: SystemConfigService,
  ) {
    this.stageHours = {
      [DisputeStage.ASSIGNMENT]: Number(this.config.get('DISPUTE_SLA_ASSIGNMENT_HOURS', 24)),
      [DisputeStage.ARBITER_REVIEW]: Number(this.config.get('DISPUTE_SLA_REVIEW_HOURS', 72)),
      [DisputeStage.APPEAL_REVIEW]: Number(this.config.get('DISPUTE_SLA_APPEAL_HOURS', 72)),
    };
    // How long before the evidence deadline (#499) both parties are warned.
    this.evidenceWarningHours = Number(this.config.get('DISPUTE_EVIDENCE_WARNING_HOURS', 12));
  }

  /** SLA hours for a stage; admin overrides apply without a restart (#503). */
  hoursFor(stage: DisputeStage): number {
    return this.systemConfig
      ? this.systemConfig.getNumber(STAGE_SYSTEM_CONFIG_KEYS[stage])
      : this.stageHours[stage];
  }

  /** Response deadline for a stage entered at `from`. */
  deadlineFor(stage: DisputeStage, from: Date = new Date()): Date {
    return new Date(from.getTime() + this.hoursFor(stage) * HOUR_MS);
  }

  /** Fields to write when a dispute enters a new stage — resets the SLA clock. */
  stageFields(stage: DisputeStage, from: Date = new Date()) {
    return {
      stage,
      responseDeadline: this.deadlineFor(stage, from),
      slaStatus: DisputeSlaStatus.ON_TRACK,
      slaEscalatedAt: null,
    };
  }

  /** SLA status to record when the current stage is completed at `at`. */
  completionStatus(
    dispute: { responseDeadline: Date | null; slaStatus: DisputeSlaStatus },
    at: Date = new Date(),
  ): DisputeSlaStatus {
    if (dispute.slaStatus === DisputeSlaStatus.OVERDUE) return DisputeSlaStatus.OVERDUE;
    if (dispute.responseDeadline && at > dispute.responseDeadline) return DisputeSlaStatus.OVERDUE;
    return DisputeSlaStatus.MET;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async flagOverdueDisputes(now: Date = new Date()): Promise<number> {
    const token = await this.lock.tryAcquireLock('cron:dispute-sla-overdue', 600_000);
    if (!token) return 0;
    try {
      const overdue = await this.prisma.dispute.findMany({
        where: {
          status: { in: ACTIVE_DISPUTE_STATUSES },
          slaStatus: DisputeSlaStatus.ON_TRACK,
          responseDeadline: { lte: now },
        },
        select: { id: true, engagementId: true, stage: true, arbiterId: true, responseDeadline: true },
      });
      if (!overdue.length) return 0;

      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, deactivatedAt: null },
        select: { id: true },
      });

      let flagged = 0;
      for (const dispute of overdue) {
        // Conditional update so concurrent job runs escalate each dispute only once.
        const { count } = await this.prisma.dispute.updateMany({
          where: { id: dispute.id, slaStatus: DisputeSlaStatus.ON_TRACK, status: { in: ACTIVE_DISPUTE_STATUSES } },
          data: { slaStatus: DisputeSlaStatus.OVERDUE, slaEscalatedAt: now },
        });
        if (!count) continue;
        flagged++;

        for (const admin of admins) {
          await this.notifications.notifyUserById(
            admin.id,
            NotificationType.DISPUTE_SLA_OVERDUE,
            'Dispute SLA breached',
            `Dispute ${dispute.id} on engagement ${dispute.engagementId} missed its ${dispute.stage} ` +
              `deadline (${dispute.responseDeadline!.toISOString()}).`,
            {
              disputeId: dispute.id,
              engagementId: dispute.engagementId,
              stage: dispute.stage,
              arbiterId: dispute.arbiterId,
              responseDeadline: dispute.responseDeadline,
            },
          );
        }
      }

      this.logger.warn(`Flagged ${flagged} overdue dispute(s)`);
      return flagged;
    } finally {
      await this.lock.releaseLock('cron:dispute-sla-overdue', token);
    }
  }

  /**
   * Warns both parties on a dispute when its evidence submission window
   * (#499) is about to close, so neither side is caught out by a deadline
   * they didn't know about. Runs on the same cadence as the SLA check and
   * fires once per dispute (tracked via evidenceDeadlineWarnedAt).
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async notifyEvidenceDeadlinesClosing(now: Date = new Date()): Promise<number> {
    const token = await this.lock.tryAcquireLock('cron:dispute-sla-evidence', 600_000);
    if (!token) return 0;
    try {
      const warnFrom = new Date(now.getTime() + this.evidenceWarningHours * HOUR_MS);

      const closingSoon = await this.prisma.dispute.findMany({
        where: {
          status: { in: ACTIVE_DISPUTE_STATUSES },
          evidenceDeadlineWarnedAt: null,
          evidenceDeadline: { not: null, lte: warnFrom, gt: now },
        },
        select: { id: true, engagementId: true, evidenceDeadline: true },
      });
      if (!closingSoon.length) return 0;

      let warned = 0;
      for (const dispute of closingSoon) {
        // Conditional update so concurrent job runs warn each dispute only once.
        const { count } = await this.prisma.dispute.updateMany({
          where: { id: dispute.id, evidenceDeadlineWarnedAt: null },
          data: { evidenceDeadlineWarnedAt: now },
        });
        if (!count) continue;
        warned++;

        const engagement = await this.prisma.engagement.findUnique({ where: { id: dispute.engagementId } });
        if (!engagement) continue;

        for (const userId of [engagement.companyId, engagement.recruiterId]) {
          if (!userId) continue;
          await this.notifications.notifyUserById(
            userId,
            NotificationType.DISPUTE_EVIDENCE_WINDOW_CLOSING,
            'Dispute evidence window closing soon',
            `The evidence submission window for dispute ${dispute.id} closes at ` +
              `${dispute.evidenceDeadline!.toISOString()}. Submit any remaining evidence before then.`,
            { disputeId: dispute.id, engagementId: dispute.engagementId, evidenceDeadline: dispute.evidenceDeadline },
          );
        }
      }

      this.logger.log(`Warned ${warned} dispute(s) of a closing evidence window`);
      return warned;
    } finally {
      await this.lock.releaseLock('cron:dispute-sla-evidence', token);
    }
  }
}
