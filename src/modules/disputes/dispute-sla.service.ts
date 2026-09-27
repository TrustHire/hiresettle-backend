import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DisputeSlaStatus, DisputeStage, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ACTIVE_DISPUTE_STATUSES } from './dispute.constants';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {
    this.stageHours = {
      [DisputeStage.ASSIGNMENT]: Number(this.config.get('DISPUTE_SLA_ASSIGNMENT_HOURS', 24)),
      [DisputeStage.ARBITER_REVIEW]: Number(this.config.get('DISPUTE_SLA_REVIEW_HOURS', 72)),
      [DisputeStage.APPEAL_REVIEW]: Number(this.config.get('DISPUTE_SLA_APPEAL_HOURS', 72)),
    };
  }

  /** Response deadline for a stage entered at `from`. */
  deadlineFor(stage: DisputeStage, from: Date = new Date()): Date {
    return new Date(from.getTime() + this.stageHours[stage] * HOUR_MS);
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
  }
}
