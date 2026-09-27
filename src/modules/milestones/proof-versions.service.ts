import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MilestoneStatus, NotificationType, Prisma, ProofVersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PartyUser, requirePartyRole } from './engagement-party';

export interface ProofInput {
  proofUrl?: string | null;
  content?: string | null;
  proofHash?: string | null;
  submittedById?: string | null;
}

/**
 * ProofVersionsService (#376)
 *
 * Keeps every proof submission as an immutable, numbered version. Rejecting
 * proof returns the milestone to PENDING so the recruiter can resubmit, and
 * only the latest version can ever be approved or rejected.
 */
@Injectable()
export class ProofVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  latest(milestoneId: string) {
    return this.prisma.milestoneProofVersion.findFirst({
      where: { milestoneId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  history(milestoneId: string) {
    return this.prisma.milestoneProofVersion.findMany({
      where: { milestoneId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  /**
   * Appends the next version. Idempotent while the latest version is still
   * awaiting review, so the on-chain proof_submitted event arriving after an
   * API submission (or a replayed event) does not create a phantom version.
   */
  async recordVersion(milestoneId: string, input: ProofInput, retry = true) {
    const latest = await this.latest(milestoneId);
    if (latest?.status === ProofVersionStatus.SUBMITTED) {
      if (input.proofHash && !latest.proofHash) {
        return this.prisma.milestoneProofVersion.update({
          where: { id: latest.id },
          data: { proofHash: input.proofHash },
        });
      }
      return latest;
    }

    try {
      return await this.prisma.milestoneProofVersion.create({
        data: {
          milestoneId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          proofUrl: input.proofUrl ?? null,
          content: input.content ?? null,
          proofHash: input.proofHash || null,
          submittedById: input.submittedById ?? null,
        },
      });
    } catch (error) {
      // Two submissions raced for the same version number — re-read and try once more.
      if (retry && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.recordVersion(milestoneId, input, false);
      }
      throw error;
    }
  }

  /** POST /engagements/:id/milestones/:index/proof — recruiter submits or resubmits proof. */
  async submitProof(engagementId: string, milestoneIndex: number, user: PartyUser, input: ProofInput) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    requirePartyRole(engagement, user, ['RECRUITER'], 'Only the recruiter can submit proof');
    if (!input.proofUrl && !input.content && !input.proofHash) {
      throw new BadRequestException('Provide at least one of proofUrl, content or proofHash.');
    }

    if (milestone.status !== MilestoneStatus.PENDING) {
      throw new UnprocessableEntityException(
        'Proof can only be submitted on a PENDING milestone (new, or after the previous proof was rejected).',
      );
    }

    // A version left pending on a PENDING milestone (e.g. after an admin status
    // reset) is superseded rather than silently reused.
    await this.prisma.milestoneProofVersion.updateMany({
      where: { milestoneId: milestone.id, status: ProofVersionStatus.SUBMITTED },
      data: { status: ProofVersionStatus.REJECTED, reviewedAt: new Date(), rejectionReason: 'Superseded by a new submission' },
    });
    const version = await this.recordVersion(milestone.id, { ...input, submittedById: user.id });
    const updated = await this.prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        status: MilestoneStatus.PROOF_SUBMITTED,
        ...(input.proofHash ? { proofHash: input.proofHash } : {}),
      },
    });

    await this.notifications.notifyUser(
      engagement.companyAddress,
      NotificationType.PROOF_SUBMITTED,
      version.versionNumber > 1 ? 'Proof resubmitted — action required' : 'Proof submitted — action required',
      `Version ${version.versionNumber} of the proof for milestone ${milestoneIndex} on engagement ` +
        `${engagementId} is ready for review.`,
      { engagementId, milestoneIndex, versionNumber: version.versionNumber },
    );

    return { ...updated, proofVersion: version };
  }

  /** Company rejects the latest proof; the recruiter may then resubmit. */
  async rejectProof(
    engagementId: string,
    milestoneIndex: number,
    user: PartyUser,
    reason: string,
    versionNumber?: number,
  ) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    requirePartyRole(engagement, user, ['COMPANY'], 'Only the company can reject proof');

    if (milestone.status !== MilestoneStatus.PROOF_SUBMITTED) {
      throw new UnprocessableEntityException('Only submitted proof can be rejected.');
    }
    const latest = await this.assertReviewable(milestone.id, versionNumber);
    if (!latest) throw new UnprocessableEntityException('This milestone has no versioned proof to reject.');

    const now = new Date();
    const { count } = await this.prisma.milestoneProofVersion.updateMany({
      where: { id: latest.id, status: ProofVersionStatus.SUBMITTED },
      data: { status: ProofVersionStatus.REJECTED, reviewedById: user.id ?? null, reviewedAt: now, rejectionReason: reason },
    });
    if (!count) throw new ConflictException('This proof version has already been reviewed.');

    const updated = await this.prisma.milestone.update({
      where: { id: milestone.id },
      data: { status: MilestoneStatus.PENDING },
    });
    // Approvals were given for the rejected proof; the next version starts fresh.
    await this.prisma.milestoneApproval.deleteMany({ where: { milestoneId: milestone.id } });

    await this.notifications.notifyUser(
      engagement.recruiterAddress,
      NotificationType.PROOF_REJECTED,
      'Proof rejected',
      `Version ${latest.versionNumber} of the proof for milestone ${milestoneIndex} on engagement ` +
        `${engagementId} was rejected: ${reason}. You can submit a new version.`,
      { engagementId, milestoneIndex, versionNumber: latest.versionNumber, reason },
    );

    return { ...updated, proofVersion: { ...latest, status: ProofVersionStatus.REJECTED, rejectionReason: reason } };
  }

  /**
   * Guards approve/reject: the caller may name the version they reviewed, and
   * it must be the latest one still awaiting review. Returns null for legacy
   * milestones that predate versioning.
   */
  async assertReviewable(milestoneId: string, versionNumber?: number) {
    const latest = await this.latest(milestoneId);
    if (!latest) {
      if (versionNumber !== undefined) throw new ConflictException('This milestone has no proof versions.');
      return null;
    }
    if (versionNumber !== undefined && versionNumber !== latest.versionNumber) {
      throw new ConflictException(
        `Proof version ${versionNumber} is outdated; only the latest version (${latest.versionNumber}) can be reviewed.`,
      );
    }
    if (latest.status !== ProofVersionStatus.SUBMITTED) {
      throw new ConflictException(`Proof version ${latest.versionNumber} has already been ${latest.status.toLowerCase()}.`);
    }
    return latest;
  }

  /** Marks the latest pending version approved once the milestone is confirmed. */
  async markApproved(milestoneId: string, reviewedById: string | null) {
    const latest = await this.latest(milestoneId);
    if (!latest || latest.status !== ProofVersionStatus.SUBMITTED) return null;
    return this.prisma.milestoneProofVersion.update({
      where: { id: latest.id },
      data: { status: ProofVersionStatus.APPROVED, reviewedById, reviewedAt: new Date() },
    });
  }

  private async load(engagementId: string, milestoneIndex: number) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      include: { engagement: true },
    });
    if (!milestone) throw new NotFoundException(`Milestone ${milestoneIndex} not found on engagement ${engagementId}`);
    const { engagement, ...rest } = milestone;
    return { milestone: rest, engagement };
  }
}
