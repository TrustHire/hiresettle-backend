import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MilestonePartialRelease,
  MilestoneStatus,
  NotificationType,
  PartialReleaseStatus,
  PartialRemainderAction,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { engagementPartyRole, PartyUser, requirePartyRole } from './engagement-party';

/** Milestone states in which the parties may agree to settle part of the escrow. */
const PARTIAL_RELEASE_STATUSES: MilestoneStatus[] = [MilestoneStatus.PROOF_SUBMITTED, MilestoneStatus.DISPUTED];

export interface PartialReleaseTerms {
  releaseAmount?: string;
  releasePercent?: number;
  remainderAction: PartialRemainderAction;
  reason?: string;
}

/**
 * PartialReleaseService (#378)
 *
 * One party proposes paying out part of a milestone; the proposal executes
 * on-chain only after the other party approves too. The remainder is either
 * refunded to the company or kept in escrow. Every step is written to the
 * milestone audit log with the amounts and transaction hash.
 */
@Injectable()
export class PartialReleaseService {
  private readonly logger = new Logger(PartialReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Splits the escrow still held on a milestone. A percentage applies to what
   * remains in escrow, rounded down to the stroop. A partial release must
   * leave something behind — full payouts go through normal approval.
   */
  static computeSplit(
    totalAmount: bigint,
    alreadyReleased: bigint,
    terms: Pick<PartialReleaseTerms, 'releaseAmount' | 'releasePercent'>,
  ): { releaseAmount: bigint; remainderAmount: bigint } {
    const remaining = totalAmount - alreadyReleased;
    if (remaining <= 0n) throw new UnprocessableEntityException('Nothing is left in escrow for this milestone.');

    const hasAmount = terms.releaseAmount !== undefined && terms.releaseAmount !== null;
    const hasPercent = terms.releasePercent !== undefined && terms.releasePercent !== null;
    if (hasAmount === hasPercent) {
      throw new BadRequestException('Provide exactly one of releaseAmount or releasePercent.');
    }

    const releaseAmount = hasAmount
      ? BigInt(terms.releaseAmount!)
      : (remaining * BigInt(terms.releasePercent!)) / 100n;

    if (releaseAmount <= 0n || releaseAmount >= remaining) {
      throw new BadRequestException(
        `A partial release must be greater than 0 and less than the ${remaining} stroops remaining in escrow.`,
      );
    }
    return { releaseAmount, remainderAmount: remaining - releaseAmount };
  }

  async list(engagementId: string, milestoneIndex: number, user: PartyUser) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    if (user.role !== UserRole.ADMIN && !engagementPartyRole(engagement, user)) {
      throw new ForbiddenException('Not a party to this engagement');
    }
    const releases = await this.prisma.milestonePartialRelease.findMany({
      where: { milestoneId: milestone.id },
      orderBy: { createdAt: 'desc' },
    });
    return releases.map(serialize);
  }

  async propose(engagementId: string, milestoneIndex: number, user: PartyUser, terms: PartialReleaseTerms) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    const role = requirePartyRole(
      engagement,
      user,
      ['COMPANY', 'RECRUITER'],
      'Only the company or recruiter can propose a partial release',
    );

    if (!PARTIAL_RELEASE_STATUSES.includes(milestone.status)) {
      throw new UnprocessableEntityException('Partial releases are only possible once proof is submitted or disputed.');
    }
    if (milestone.amount === null) throw new UnprocessableEntityException('Milestone amount is not set.');

    const open = await this.prisma.milestonePartialRelease.findFirst({
      where: { milestoneId: milestone.id, status: PartialReleaseStatus.PROPOSED },
    });
    if (open) throw new ConflictException('A partial release proposal is already open on this milestone.');

    const split = PartialReleaseService.computeSplit(milestone.amount, milestone.paymentReleased ?? 0n, terms);
    const now = new Date();

    let release: MilestonePartialRelease;
    try {
      release = await this.prisma.milestonePartialRelease.create({
        data: {
          milestoneId: milestone.id,
          engagementId,
          proposedById: user.id,
          ...split,
          remainderAction: terms.remainderAction,
          reason: terms.reason ?? null,
          // Proposing counts as the proposer's approval.
          ...(role === 'COMPANY'
            ? { companyApproverId: user.id, companyApprovedAt: now }
            : { recruiterApproverId: user.id, recruiterApprovedAt: now }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A partial release proposal is already open on this milestone.');
      }
      throw error;
    }

    await this.audit(milestone.id, milestone.status, milestone.status, user.id, 'PARTIAL_RELEASE_PROPOSED', {
      releaseId: release.id,
      proposedBy: role,
      releaseAmount: split.releaseAmount.toString(),
      remainderAmount: split.remainderAmount.toString(),
      remainderAction: terms.remainderAction,
    });

    const counterparty = role === 'COMPANY' ? engagement.recruiterAddress : engagement.companyAddress;
    await this.notifications.notifyUser(
      counterparty,
      NotificationType.PARTIAL_RELEASE_PROPOSED,
      'Partial release proposed',
      `A partial release of ${split.releaseAmount} stroops was proposed for milestone ${milestoneIndex} on ` +
        `engagement ${engagementId}; the remaining ${split.remainderAmount} would be ` +
        `${terms.remainderAction === PartialRemainderAction.REFUND ? 'refunded to the company' : 'kept in escrow'}. ` +
        'It needs your approval.',
      { engagementId, milestoneIndex, releaseId: release.id },
    );

    return serialize(release);
  }

  /** The counterparty signs off; once both sides have approved it executes on-chain. */
  async approve(engagementId: string, milestoneIndex: number, releaseId: string, user: PartyUser) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    const role = requirePartyRole(
      engagement,
      user,
      ['COMPANY', 'RECRUITER'],
      'Only the company or recruiter can approve a partial release',
    );
    const release = await this.findOpen(milestone.id, releaseId);

    const side =
      role === 'COMPANY'
        ? { where: { companyApprovedAt: null }, data: { companyApproverId: user.id, companyApprovedAt: new Date() } }
        : { where: { recruiterApprovedAt: null }, data: { recruiterApproverId: user.id, recruiterApprovedAt: new Date() } };

    const { count } = await this.prisma.milestonePartialRelease.updateMany({
      where: { id: release.id, status: PartialReleaseStatus.PROPOSED, ...side.where },
      data: side.data,
    });
    if (!count) throw new ConflictException('You have already approved this partial release.');

    const updated = await this.prisma.milestonePartialRelease.findUniqueOrThrow({ where: { id: release.id } });
    if (!PartialReleaseService.hasDualApproval(updated)) return serialize(updated);

    return serialize(await this.execute(updated, milestone, engagement, user.id));
  }

  async reject(engagementId: string, milestoneIndex: number, releaseId: string, user: PartyUser) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    requirePartyRole(engagement, user, ['COMPANY', 'RECRUITER'], 'Only the company or recruiter can reject a partial release');
    const release = await this.findOpen(milestone.id, releaseId);

    const { count } = await this.prisma.milestonePartialRelease.updateMany({
      where: { id: release.id, status: PartialReleaseStatus.PROPOSED, executedAt: null },
      data: { status: PartialReleaseStatus.REJECTED },
    });
    if (!count) throw new ConflictException('This partial release is no longer open.');

    await this.audit(milestone.id, milestone.status, milestone.status, user.id, 'PARTIAL_RELEASE_REJECTED', {
      releaseId: release.id,
    });
    return serialize({ ...release, status: PartialReleaseStatus.REJECTED });
  }

  static hasDualApproval(release: Pick<MilestonePartialRelease, 'companyApprovedAt' | 'recruiterApprovedAt'>) {
    return !!release.companyApprovedAt && !!release.recruiterApprovedAt;
  }

  private async execute(
    release: MilestonePartialRelease,
    milestone: MilestoneRow,
    engagement: { id: string; companyAddress: string; recruiterAddress: string },
    actorId: string,
  ) {
    if (!PartialReleaseService.hasDualApproval(release)) {
      throw new ConflictException('Both the company and the recruiter must approve before funds move.');
    }

    // Claim execution so two near-simultaneous approvals cannot pay out twice.
    const now = new Date();
    const { count } = await this.prisma.milestonePartialRelease.updateMany({
      where: { id: release.id, status: PartialReleaseStatus.PROPOSED, executedAt: null },
      data: { executedAt: now },
    });
    if (!count) return this.prisma.milestonePartialRelease.findUniqueOrThrow({ where: { id: release.id } });

    const refundRemainder = release.remainderAction === PartialRemainderAction.REFUND;
    let txHash: string;
    try {
      txHash = await this.stellar.releasePartialMilestonePayment(
        engagement.id,
        milestone.milestoneIndex,
        release.releaseAmount,
        refundRemainder,
      );
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      await this.prisma.milestonePartialRelease.update({
        where: { id: release.id },
        data: { status: PartialReleaseStatus.FAILED, failureReason, executedAt: null },
      });
      await this.audit(milestone.id, milestone.status, milestone.status, actorId, 'PARTIAL_RELEASE_FAILED', {
        releaseId: release.id,
        releaseAmount: release.releaseAmount.toString(),
        failureReason,
      });
      this.logger.error(`Partial release ${release.id} failed on-chain: ${failureReason}`);
      throw error;
    }

    const previouslyReleased = milestone.paymentReleased ?? 0n;
    const toStatus = refundRemainder ? MilestoneStatus.CONFIRMED : milestone.status;

    await this.prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        paymentReleased: previouslyReleased + release.releaseAmount,
        ...(refundRemainder ? { status: MilestoneStatus.CONFIRMED, confirmedAt: now } : {}),
      },
    });
    await this.prisma.engagement.update({
      where: { id: engagement.id },
      data: { releasedAmount: { increment: release.releaseAmount } },
    });
    if (refundRemainder) {
      const refund = {
        amount: release.remainderAmount,
        status: 'COMPLETED' as const,
        reason: `Remainder of partial release ${release.id} refunded on-chain (tx ${txHash})`,
      };
      await this.prisma.refund.upsert({
        where: { milestoneId: milestone.id },
        update: refund,
        create: { milestoneId: milestone.id, ...refund },
      });
    }

    const executed = await this.prisma.milestonePartialRelease.update({
      where: { id: release.id },
      data: { status: PartialReleaseStatus.EXECUTED, txHash },
    });

    await this.audit(milestone.id, milestone.status, toStatus, actorId, 'PARTIAL_RELEASE_EXECUTED', {
      releaseId: release.id,
      txHash,
      milestoneAmount: milestone.amount?.toString() ?? null,
      previouslyReleased: previouslyReleased.toString(),
      releaseAmount: release.releaseAmount.toString(),
      remainderAmount: release.remainderAmount.toString(),
      remainderAction: release.remainderAction,
      totalReleased: (previouslyReleased + release.releaseAmount).toString(),
    });

    const message =
      `${release.releaseAmount} stroops were released for milestone ${milestone.milestoneIndex} on engagement ` +
      `${engagement.id}; the remaining ${release.remainderAmount} ` +
      `${refundRemainder ? 'was refunded to the company' : 'stays in escrow'} (tx ${txHash}).`;
    for (const address of [engagement.companyAddress, engagement.recruiterAddress]) {
      await this.notifications.notifyUser(address, NotificationType.PARTIAL_RELEASE_EXECUTED, 'Partial release executed', message, {
        engagementId: engagement.id,
        milestoneIndex: milestone.milestoneIndex,
        releaseId: release.id,
        txHash,
      });
    }

    return executed;
  }

  private async findOpen(milestoneId: string, releaseId: string) {
    const release = await this.prisma.milestonePartialRelease.findUnique({ where: { id: releaseId } });
    if (!release || release.milestoneId !== milestoneId) {
      throw new NotFoundException(`Partial release ${releaseId} not found on this milestone`);
    }
    if (release.status !== PartialReleaseStatus.PROPOSED) {
      throw new ConflictException(`This partial release is ${release.status.toLowerCase()}.`);
    }
    return release;
  }

  private audit(
    milestoneId: string,
    fromStatus: MilestoneStatus,
    toStatus: MilestoneStatus,
    changedBy: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    return this.prisma.milestoneAuditLog.create({
      data: { milestoneId, fromStatus, toStatus, changedBy, action, details },
    });
  }

  private async load(engagementId: string, milestoneIndex: number) {
    const found = await this.prisma.milestone.findUnique({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      include: { engagement: true },
    });
    if (!found) throw new NotFoundException(`Milestone ${milestoneIndex} not found on engagement ${engagementId}`);
    const { engagement, ...milestone } = found;
    return { milestone, engagement };
  }
}

type MilestoneRow = {
  id: string;
  milestoneIndex: number;
  status: MilestoneStatus;
  amount: bigint | null;
  paymentReleased: bigint | null;
};

function serialize(release: MilestonePartialRelease) {
  return {
    ...release,
    releaseAmount: release.releaseAmount.toString(),
    remainderAmount: release.remainderAmount.toString(),
  };
}
