import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DisputeAppealStatus,
  DisputeOutcome,
  DisputeStage,
  DisputeStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ArbiterAssignmentService } from './arbiter-assignment.service';
import { DisputeSlaService } from './dispute-sla.service';
import { DisputeActor, DisputesService } from './disputes.service';

/**
 * AppealService (#382)
 *
 * Either party may appeal a first-tier decision once, within the appeal
 * window. The appeal goes to a different, non-conflicted arbiter and funds
 * stay locked until it is decided. The appeal decision is final
 * (isFinal = true) and cannot itself be appealed.
 */
@Injectable()
export class AppealService {
  private readonly logger = new Logger(AppealService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly disputes: DisputesService,
    private readonly arbiters: ArbiterAssignmentService,
    private readonly sla: DisputeSlaService,
  ) {}

  async openAppeal(disputeId: string, user: DisputeActor, reason: string, now: Date = new Date()) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { engagement: true, appeal: true },
    });
    if (!dispute) throw new NotFoundException(`Dispute ${disputeId} not found`);
    if (!this.disputes.isParty(dispute.engagement, user)) {
      throw new ForbiddenException('Only the company or recruiter on this engagement may appeal');
    }
    if (dispute.appeal) throw new ConflictException('This dispute has already been appealed');
    if (dispute.isFinal) throw new ConflictException('This decision is final and cannot be appealed');
    if (dispute.status !== DisputeStatus.RESOLVED || !dispute.outcome || !dispute.appealDeadline) {
      throw new UnprocessableEntityException('No appealable decision has been recorded for this dispute');
    }
    if (now > dispute.appealDeadline) {
      throw new UnprocessableEntityException(
        `The appeal window closed at ${dispute.appealDeadline.toISOString()}`,
      );
    }

    const originalArbiterId = dispute.arbiterId;
    const arbiter = await this.arbiters.selectArbiter(dispute.engagement, originalArbiterId ? [originalArbiterId] : []);

    let appeal;
    try {
      appeal = await this.prisma.$transaction(async (tx) => {
        // Guarded transition: loses cleanly to the appeal-window job or a concurrent appeal.
        const { count } = await tx.dispute.updateMany({
          where: { id: disputeId, status: DisputeStatus.RESOLVED, isFinal: false, appealDeadline: { gte: now } },
          data: {
            status: arbiter ? DisputeStatus.UNDER_REVIEW : DisputeStatus.OPEN,
            arbiterId: arbiter?.id ?? null,
            arbiterAssignedAt: arbiter ? now : null,
            arbiterManuallyAssigned: false,
            fundsLocked: true,
            ...this.sla.stageFields(DisputeStage.APPEAL_REVIEW, now),
          },
        });
        if (!count) throw new ConflictException('The dispute can no longer be appealed');

        return tx.disputeAppeal.create({
          data: {
            disputeId,
            appellantId: user.id,
            reason,
            originalArbiterId,
            arbiterId: arbiter?.id ?? null,
            originalOutcome: dispute.outcome!,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This dispute has already been appealed');
      }
      throw error;
    }

    await this.disputes.notifyParties(
      dispute.engagementId,
      NotificationType.DISPUTE_APPEALED,
      'Dispute decision appealed',
      `The decision on dispute ${disputeId} has been appealed. Escrowed funds remain locked until the appeal is decided.`,
      { disputeId, appealId: appeal.id },
      user.id,
    );

    if (arbiter) {
      await this.notifications.notifyUserById(
        arbiter.id,
        NotificationType.ARBITER_ASSIGNED,
        'Appeal assigned',
        `You have been assigned the appeal on dispute ${disputeId} (engagement ${dispute.engagementId}).`,
        { disputeId, appealId: appeal.id, engagementId: dispute.engagementId },
      );
    } else {
      this.logger.warn(`No eligible appeal arbiter for dispute ${disputeId}; awaiting manual assignment`);
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, deactivatedAt: null },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.notifications.notifyUserById(
          admin.id,
          NotificationType.DISPUTE_APPEALED,
          'Appeal needs an arbiter',
          `No eligible arbiter is available for the appeal on dispute ${disputeId}. Please assign one.`,
          { disputeId, appealId: appeal.id, engagementId: dispute.engagementId },
        );
      }
    }

    return appeal;
  }

  /** Final decision on an appeal. Settles the milestone on-chain immediately. */
  async decideAppeal(disputeId: string, user: DisputeActor, outcome: DisputeOutcome) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId }, include: { appeal: true } });
    if (!dispute) throw new NotFoundException(`Dispute ${disputeId} not found`);
    const { appeal } = dispute;
    if (dispute.stage !== DisputeStage.APPEAL_REVIEW || !appeal || appeal.status !== DisputeAppealStatus.OPEN) {
      throw new UnprocessableEntityException('This dispute has no open appeal');
    }
    if (user.role !== UserRole.ADMIN && dispute.arbiterId !== user.id) {
      throw new ForbiddenException('Only the assigned appeal arbiter can decide this appeal');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.disputeAppeal.updateMany({
        where: { id: appeal.id, status: DisputeAppealStatus.OPEN },
        data: { status: DisputeAppealStatus.DECIDED, outcome, isFinal: true, decidedAt: now },
      });
      if (!count) throw new ConflictException('This appeal has already been decided');

      // appealDeadline = now: the window is closed, and if settlement fails
      // below the appeal-window job picks the dispute up and retries.
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: DisputeStatus.RESOLVED,
          outcome,
          resolvedAt: now,
          appealDeadline: now,
          isFinal: true,
          slaStatus: this.sla.completionStatus(dispute, now),
        },
      });
    });

    await this.disputes.notifyParties(
      dispute.engagementId,
      NotificationType.DISPUTE_APPEAL_DECIDED,
      'Appeal decided',
      `The appeal on dispute ${disputeId} was decided: ${outcome}` +
        `${outcome === appeal.originalOutcome ? ' (original decision upheld)' : ' (original decision overturned)'}. ` +
        'This decision is final.',
      { disputeId, appealId: appeal.id, outcome, originalOutcome: appeal.originalOutcome },
    );

    return this.disputes.settle(disputeId);
  }

  /**
   * Settles disputes whose appeal window lapsed without an appeal, and retries
   * final decisions whose settlement previously failed.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async finalizeExpiredAppealWindows(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.dispute.findMany({
      where: { status: DisputeStatus.RESOLVED, appealDeadline: { lt: now } },
      select: { id: true, isFinal: true },
    });

    let settled = 0;
    for (const dispute of expired) {
      if (!dispute.isFinal) {
        const { count } = await this.prisma.dispute.updateMany({
          where: { id: dispute.id, status: DisputeStatus.RESOLVED, isFinal: false, appealDeadline: { lt: now } },
          data: { isFinal: true },
        });
        if (!count) continue;
      }
      try {
        await this.disputes.settle(dispute.id);
        settled++;
      } catch (error) {
        this.logger.error(`Failed to settle dispute ${dispute.id}`, error instanceof Error ? error.message : error);
      }
    }
    return settled;
  }
}
