import { Injectable, Logger } from '@nestjs/common';
import { DisputeStage, DisputeStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DisputeSlaService } from './dispute-sla.service';
import { ACTIVE_DISPUTE_STATUSES } from './dispute.constants';

export interface EngagementParties {
  id: string;
  companyId: string | null;
  recruiterId: string | null;
  companyAddress: string;
  recruiterAddress: string;
}

export interface ArbiterCandidate {
  id: string;
  name: string | null;
  stellarAddress: string | null;
  activeDisputes: number;
}

/**
 * ArbiterAssignmentService (#383)
 *
 * Routes new disputes to the eligible arbiter with the fewest active
 * (OPEN / UNDER_REVIEW) disputes. Arbiters who recused themselves from the
 * engagement, or who are a party to it, are never selected. An admin override
 * (PATCH /admin/engagements/:id/arbiter) marks the dispute as manually assigned,
 * after which auto-assignment never touches it again.
 */
@Injectable()
export class ArbiterAssignmentService {
  private readonly logger = new Logger(ArbiterAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly sla: DisputeSlaService,
  ) {}

  /** Arbiter user ids that must not decide disputes on this engagement. */
  async conflictedArbiterIds(engagement: EngagementParties): Promise<Set<string>> {
    const recusals = await this.prisma.arbiterRecusal.findMany({
      where: { engagementId: engagement.id },
      select: { arbiterId: true },
    });
    const conflicted = new Set(recusals.map((r) => r.arbiterId));
    if (engagement.companyId) conflicted.add(engagement.companyId);
    if (engagement.recruiterId) conflicted.add(engagement.recruiterId);
    return conflicted;
  }

  /**
   * Picks the least-loaded eligible arbiter. Ties go to the longest-standing
   * arbiter so selection is deterministic. Returns null when nobody is eligible.
   */
  async selectArbiter(engagement: EngagementParties, exclude: string[] = []): Promise<ArbiterCandidate | null> {
    const conflicted = await this.conflictedArbiterIds(engagement);
    for (const id of exclude) conflicted.add(id);
    const partyAddresses = new Set([engagement.companyAddress, engagement.recruiterAddress]);

    const arbiters = await this.prisma.user.findMany({
      where: {
        role: UserRole.ARBITER,
        deactivatedAt: null,
        deletedAt: null,
        id: { notIn: [...conflicted] },
      },
      select: { id: true, name: true, stellarAddress: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const eligible = arbiters.filter((a) => !a.stellarAddress || !partyAddresses.has(a.stellarAddress));
    if (!eligible.length) return null;

    const loads = await this.prisma.dispute.groupBy({
      by: ['arbiterId'],
      where: { arbiterId: { in: eligible.map((a) => a.id) }, status: { in: ACTIVE_DISPUTE_STATUSES } },
      _count: { _all: true },
    });
    const loadById = new Map(loads.map((l) => [l.arbiterId, l._count._all]));

    let best: ArbiterCandidate | null = null;
    for (const arbiter of eligible) {
      const activeDisputes = loadById.get(arbiter.id) ?? 0;
      if (!best || activeDisputes < best.activeDisputes) best = { ...arbiter, activeDisputes };
    }
    return best;
  }

  /**
   * Assigns an arbiter to a freshly opened dispute. No-op when the dispute
   * already has an arbiter or was assigned manually. When no arbiter is
   * eligible the dispute stays in the ASSIGNMENT stage and its SLA escalates
   * to admins.
   */
  async autoAssign(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { engagement: true },
    });
    if (!dispute || dispute.arbiterId || dispute.arbiterManuallyAssigned || dispute.status !== DisputeStatus.OPEN) {
      return dispute;
    }

    const arbiter = await this.selectArbiter(dispute.engagement);
    if (!arbiter) {
      this.logger.warn(`No eligible arbiter for dispute ${disputeId}; awaiting manual assignment`);
      return dispute;
    }

    // Conditional update: a concurrent admin override must win.
    const { count } = await this.prisma.dispute.updateMany({
      where: { id: disputeId, arbiterId: null, arbiterManuallyAssigned: false },
      data: {
        arbiterId: arbiter.id,
        arbiterAssignedAt: new Date(),
        status: DisputeStatus.UNDER_REVIEW,
        ...this.sla.stageFields(DisputeStage.ARBITER_REVIEW),
      },
    });

    if (count) {
      await this.notifications.notifyUserById(
        arbiter.id,
        NotificationType.ARBITER_ASSIGNED,
        'Dispute assigned',
        `You have been assigned dispute ${disputeId} on engagement ${dispute.engagementId}.`,
        { disputeId, engagementId: dispute.engagementId },
      );
    }

    return this.prisma.dispute.findUnique({ where: { id: disputeId } });
  }

  /**
   * Admin override: pins every active dispute on the engagement to the given
   * arbiter. Appeals keep their independence — an appeal is never handed back
   * to the arbiter whose decision is being appealed.
   */
  async applyManualOverride(engagementId: string, arbiterId: string): Promise<number> {
    const disputes = await this.prisma.dispute.findMany({
      where: { engagementId, status: { in: ACTIVE_DISPUTE_STATUSES } },
      include: { appeal: true },
    });

    let updated = 0;
    for (const dispute of disputes) {
      const isAppeal = dispute.stage === DisputeStage.APPEAL_REVIEW;
      if (isAppeal && dispute.appeal?.originalArbiterId === arbiterId) {
        this.logger.warn(`Skipping override for appeal on dispute ${dispute.id}: arbiter made the original decision`);
        continue;
      }

      await this.prisma.dispute.update({
        where: { id: dispute.id },
        data: {
          arbiterId,
          arbiterAssignedAt: new Date(),
          arbiterManuallyAssigned: true,
          status: DisputeStatus.UNDER_REVIEW,
          ...(dispute.stage === DisputeStage.ASSIGNMENT ? this.sla.stageFields(DisputeStage.ARBITER_REVIEW) : {}),
        },
      });
      if (isAppeal && dispute.appeal) {
        await this.prisma.disputeAppeal.update({ where: { id: dispute.appeal.id }, data: { arbiterId } });
      }
      updated++;
    }
    return updated;
  }
}
