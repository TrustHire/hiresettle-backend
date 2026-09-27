import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Dispute,
  DisputeOutcome,
  DisputeStage,
  DisputeStatus,
  MilestoneStatus,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ArbiterAssignmentService, EngagementParties } from './arbiter-assignment.service';
import { DisputeSlaService } from './dispute-sla.service';
import { ACTIVE_DISPUTE_STATUSES } from './dispute.constants';

const HOUR_MS = 60 * 60 * 1000;

export interface DisputeActor {
  id: string;
  role: UserRole | string;
  stellarAddress?: string | null;
}

/**
 * DisputesService (#381, #382, #383)
 *
 * Owns the Dispute record that shadows a DISPUTED milestone. A first-tier
 * decision does not move funds: it opens an appeal window
 * (DISPUTE_APPEAL_WINDOW_HOURS, default 72h) during which escrow stays locked.
 * Settlement on-chain happens only once the decision is final — the window
 * lapsed, or an appeal was decided.
 */
@Injectable()
export class DisputesService {
  private readonly appealWindowHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly arbiters: ArbiterAssignmentService,
    private readonly sla: DisputeSlaService,
  ) {
    this.appealWindowHours = Number(this.config.get('DISPUTE_APPEAL_WINDOW_HOURS', 72));
  }

  // ----------------------------------------------------------
  // OPEN
  // ----------------------------------------------------------

  /**
   * Creates the Dispute for a milestone that just became DISPUTED and routes
   * it to an arbiter. Idempotent: an existing unsettled dispute is returned
   * as-is, so replays of the on-chain event do not create duplicates.
   */
  async openForMilestone(milestoneId: string, opts: { reason?: string | null; raisedById?: string | null } = {}) {
    const existing = await this.prisma.dispute.findFirst({
      where: { milestoneId, status: { not: DisputeStatus.CLOSED } },
    });
    if (existing) return existing;

    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { engagementId: true, disputeReason: true },
    });
    if (!milestone) throw new NotFoundException(`Milestone ${milestoneId} not found`);

    const dispute = await this.prisma.dispute.create({
      data: {
        engagementId: milestone.engagementId,
        milestoneId,
        raisedById: opts.raisedById ?? null,
        reason: opts.reason ?? milestone.disputeReason,
        status: DisputeStatus.OPEN,
        fundsLocked: true,
        ...this.sla.stageFields(DisputeStage.ASSIGNMENT),
      },
    });

    return (await this.arbiters.autoAssign(dispute.id)) ?? dispute;
  }

  // ----------------------------------------------------------
  // READ
  // ----------------------------------------------------------

  async findOneForUser(id: string, user: DisputeActor, now: Date = new Date()) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        appeal: true,
        engagement: true,
        milestone: { select: { id: true, milestoneIndex: true, name: true, status: true, amount: true } },
      },
    });
    if (!dispute) throw new NotFoundException(`Dispute ${id} not found`);
    if (!this.canView(dispute, user)) throw new ForbiddenException('Not a party to this dispute');

    const { engagement, milestone, ...rest } = dispute;
    return {
      ...rest,
      engagement: { id: engagement.id, jobTitle: engagement.jobTitle, status: engagement.status },
      milestone: { ...milestone, amount: milestone.amount?.toString() ?? null },
      sla: {
        stage: dispute.stage,
        responseDeadline: dispute.responseDeadline,
        slaStatus: dispute.slaStatus,
        isOverdue:
          ACTIVE_DISPUTE_STATUSES.includes(dispute.status) &&
          !!dispute.responseDeadline &&
          now > dispute.responseDeadline,
      },
      appealWindow: {
        deadline: dispute.appealDeadline,
        isOpen: this.isAppealWindowOpen(dispute, now),
      },
    };
  }

  isAppealWindowOpen(
    dispute: Pick<Dispute, 'status' | 'isFinal' | 'appealDeadline'> & { appeal?: unknown },
    now: Date = new Date(),
  ): boolean {
    return (
      dispute.status === DisputeStatus.RESOLVED &&
      !dispute.isFinal &&
      !dispute.appeal &&
      !!dispute.appealDeadline &&
      now <= dispute.appealDeadline
    );
  }

  /** Company or recruiter on the engagement — the two sides who may appeal. */
  isParty(engagement: EngagementParties, user: DisputeActor): boolean {
    if (user.id && (user.id === engagement.companyId || user.id === engagement.recruiterId)) return true;
    return (
      !!user.stellarAddress &&
      (user.stellarAddress === engagement.companyAddress || user.stellarAddress === engagement.recruiterAddress)
    );
  }

  private canView(
    dispute: Dispute & { engagement: EngagementParties & { arbiterAddress: string }; appeal: { arbiterId: string | null } | null },
    user: DisputeActor,
  ): boolean {
    if (user.role === UserRole.ADMIN) return true;
    if (this.isParty(dispute.engagement, user)) return true;
    if (user.id === dispute.arbiterId || user.id === dispute.appeal?.arbiterId) return true;
    return !!user.stellarAddress && user.stellarAddress === dispute.engagement.arbiterAddress;
  }

  // ----------------------------------------------------------
  // DECIDE (first tier)
  // ----------------------------------------------------------

  /**
   * Records a first-tier decision on the milestone's active dispute.
   * Returns null when the milestone has no Dispute record (legacy disputes),
   * in which case the caller settles on-chain immediately as before.
   */
  async recordDecision(milestoneId: string, outcome: DisputeOutcome, actor?: DisputeActor) {
    const dispute = await this.prisma.dispute.findFirst({
      where: { milestoneId, status: { not: DisputeStatus.CLOSED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!dispute) return null;
    return this.decide(dispute, outcome, actor);
  }

  async decide(dispute: Dispute, outcome: DisputeOutcome, actor?: DisputeActor) {
    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new ConflictException('A decision has already been recorded for this dispute');
    }
    if (dispute.stage === DisputeStage.APPEAL_REVIEW) {
      throw new ConflictException('This dispute is under appeal; the appeal arbiter must decide it');
    }
    if (actor && actor.role !== UserRole.ADMIN && dispute.arbiterId && dispute.arbiterId !== actor.id) {
      throw new ForbiddenException('Only the assigned arbiter can decide this dispute');
    }

    const now = new Date();
    const deferred = this.appealWindowHours > 0;
    const appealDeadline = new Date(now.getTime() + (deferred ? this.appealWindowHours * HOUR_MS : 0));

    const { count } = await this.prisma.dispute.updateMany({
      where: { id: dispute.id, status: { in: ACTIVE_DISPUTE_STATUSES } },
      data: {
        status: DisputeStatus.RESOLVED,
        outcome,
        resolvedAt: now,
        appealDeadline,
        slaStatus: this.sla.completionStatus(dispute, now),
        fundsLocked: true,
        isFinal: !deferred,
      },
    });
    if (!count) throw new ConflictException('The dispute is no longer awaiting a decision');

    if (!deferred) return this.settle(dispute.id);

    const updated = await this.prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    await this.notifyParties(
      updated.engagementId,
      NotificationType.DISPUTE_RESOLVED,
      'Dispute decision recorded',
      `The arbiter decided dispute ${updated.id}: ${outcome}. Either party may appeal until ` +
        `${appealDeadline.toISOString()}; escrowed funds stay locked until then.`,
      { disputeId: updated.id, outcome, appealDeadline },
    );
    return updated;
  }

  // ----------------------------------------------------------
  // SETTLE
  // ----------------------------------------------------------

  /**
   * Executes a final decision: refunds or releases the milestone on-chain and
   * unlocks the dispute. Claims the dispute first (RESOLVED → CLOSED) so the
   * appeal-window job and an in-request settlement can never both pay out;
   * on failure the claim is rolled back so the job retries.
   */
  async settle(disputeId: string) {
    const { count } = await this.prisma.dispute.updateMany({
      where: { id: disputeId, status: DisputeStatus.RESOLVED, isFinal: true, fundsReleasedAt: null },
      data: { status: DisputeStatus.CLOSED },
    });
    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: { milestone: true },
    });
    if (!count) return dispute;

    const { milestone } = dispute;
    const approved = dispute.outcome === DisputeOutcome.RELEASE;
    const amount = BigInt(milestone.amount ?? 0);

    try {
      if (!approved) {
        await this.prisma.refund.upsert({
          where: { milestoneId: milestone.id },
          update: { amount, status: 'PENDING', reason: 'Resolved dispute in favor of the company' },
          create: { milestoneId: milestone.id, amount, status: 'PENDING', reason: 'Resolved dispute in favor of the company' },
        });
      }

      await this.stellar.resolveMilestoneDispute(dispute.engagementId, milestone.milestoneIndex, approved);
    } catch (error) {
      await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: DisputeStatus.RESOLVED } });
      throw error;
    }

    const now = new Date();
    await this.prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        status: approved ? MilestoneStatus.RESOLVED : MilestoneStatus.PENDING,
        ...(approved && amount ? { paymentReleased: amount, confirmedAt: now } : {}),
      },
    });

    const settled = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { fundsLocked: false, fundsReleasedAt: now },
    });

    await this.notifyParties(
      dispute.engagementId,
      NotificationType.DISPUTE_RESOLVED,
      'Dispute closed',
      `Dispute ${disputeId} is final (${dispute.outcome}); escrowed funds have been ` +
        `${approved ? 'released to the recruiter' : 'refunded to the company'}.`,
      { disputeId, outcome: dispute.outcome, final: true },
    );

    return settled;
  }

  /**
   * Closes any unsettled dispute on a milestone that was resolved on-chain
   * outside this workflow (e.g. a replayed dispute_resolved event), so it
   * stops counting toward arbiter workload and SLA checks.
   */
  async markSettledOnChain(milestoneId: string) {
    const now = new Date();
    return this.prisma.dispute.updateMany({
      where: { milestoneId, fundsReleasedAt: null },
      data: { status: DisputeStatus.CLOSED, isFinal: true, fundsLocked: false, fundsReleasedAt: now },
    });
  }

  async notifyParties(
    engagementId: string,
    type: NotificationType,
    title: string,
    message: string,
    data: Record<string, any>,
    excludeUserId?: string,
  ) {
    const engagement = await this.prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement) return;
    for (const userId of [engagement.companyId, engagement.recruiterId]) {
      if (!userId || userId === excludeUserId) continue;
      await this.notifications.notifyUserById(userId, type, title, message, { engagementId, ...data });
    }
  }
}
