import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MilestoneStatus, NotificationType, ProofSlaAction, ProofVersionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MilestonesService } from './milestones.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PROOF_SLA_DAYS = 7;

export interface ProofSlaRunSummary {
  reminders50: number;
  reminders90: number;
  autoApproved: number;
  escalated: number;
}

/**
 * MilestoneProofSlaService (#377)
 *
 * Companies have `proofSlaDays` (default 7) to review submitted proof. Every
 * hour this job checks each pending proof version against its company's SLA:
 *   - at 50% and 90% of the window the company gets a reminder;
 *   - at 100% the company's `proofSlaAction` runs: AUTO_APPROVE releases the
 *     payment, ESCALATE_TO_ADMIN notifies every admin.
 * Each step is claimed with a conditional update so it fires exactly once per
 * version; a resubmitted proof is a new version and restarts the clock.
 */
@Injectable()
export class MilestoneProofSlaService {
  private readonly logger = new Logger(MilestoneProofSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    private readonly milestones: MilestonesService,
  ) {}

  static elapsedFraction(submittedAt: Date, slaDays: number, now: Date): number {
    return (now.getTime() - submittedAt.getTime()) / (slaDays * DAY_MS);
  }

  static deadline(submittedAt: Date, slaDays: number): Date {
    return new Date(submittedAt.getTime() + slaDays * DAY_MS);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runProofSlaChecks(now: Date = new Date()): Promise<ProofSlaRunSummary> {
    const summary: ProofSlaRunSummary = { reminders50: 0, reminders90: 0, autoApproved: 0, escalated: 0 };

    const pending = await this.prisma.milestoneProofVersion.findMany({
      where: {
        status: ProofVersionStatus.SUBMITTED,
        slaExpiredAt: null,
        milestone: { status: MilestoneStatus.PROOF_SUBMITTED },
      },
      include: {
        milestone: {
          include: {
            engagement: {
              include: { company: { select: { id: true, proofSlaDays: true, proofSlaAction: true } } },
            },
          },
        },
      },
    });

    for (const version of pending) {
      try {
        await this.evaluate(version, now, summary);
      } catch (error) {
        this.logger.error(
          `Proof SLA check failed for version ${version.id}`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return summary;
  }

  private async evaluate(version: PendingVersion, now: Date, summary: ProofSlaRunSummary) {
    const company = version.milestone.engagement.company;
    const slaDays = company?.proofSlaDays || DEFAULT_PROOF_SLA_DAYS;
    const action = company?.proofSlaAction ?? ProofSlaAction.ESCALATE_TO_ADMIN;
    const fraction = MilestoneProofSlaService.elapsedFraction(version.submittedAt, slaDays, now);

    if (fraction >= 1) {
      const claimed = await this.claim(version.id, { slaExpiredAt: null }, { slaExpiredAt: now });
      if (!claimed) return;
      if (action === ProofSlaAction.AUTO_APPROVE) {
        await this.autoApprove(version, now);
        summary.autoApproved++;
      } else {
        await this.escalate(version, slaDays);
        summary.escalated++;
      }
      return;
    }

    if (fraction >= 0.9 && !version.reminder90SentAt) {
      // If the job was down past the 50% mark, the 90% reminder covers both.
      const claimed = await this.claim(
        version.id,
        { reminder90SentAt: null },
        { reminder90SentAt: now, reminder50SentAt: version.reminder50SentAt ?? now },
      );
      if (claimed) {
        await this.remind(version, 90, slaDays, action);
        summary.reminders90++;
      }
      return;
    }

    if (fraction >= 0.5 && !version.reminder50SentAt) {
      const claimed = await this.claim(version.id, { reminder50SentAt: null }, { reminder50SentAt: now });
      if (claimed) {
        await this.remind(version, 50, slaDays, action);
        summary.reminders50++;
      }
    }
  }

  private async claim(id: string, where: Record<string, null>, data: Record<string, Date>): Promise<boolean> {
    const { count } = await this.prisma.milestoneProofVersion.updateMany({
      where: { id, status: ProofVersionStatus.SUBMITTED, ...where },
      data,
    });
    return count > 0;
  }

  private async remind(version: PendingVersion, percent: 50 | 90, slaDays: number, action: ProofSlaAction) {
    const { milestone } = version;
    const deadline = MilestoneProofSlaService.deadline(version.submittedAt, slaDays);
    const consequence =
      action === ProofSlaAction.AUTO_APPROVE ? 'the proof will be approved automatically' : 'it will be escalated to an admin';

    await this.notifications.notifyUser(
      milestone.engagement.companyAddress,
      NotificationType.PROOF_REVIEW_REMINDER,
      percent === 90 ? 'Proof review deadline is close' : 'Proof awaiting your review',
      `${percent}% of the ${slaDays}-day review window for milestone ${milestone.milestoneIndex} on ` +
        `engagement ${milestone.engagementId} has passed. Review by ${deadline.toISOString()}, after which ${consequence}.`,
      {
        engagementId: milestone.engagementId,
        milestoneIndex: milestone.milestoneIndex,
        versionNumber: version.versionNumber,
        percent,
        deadline,
      },
    );
  }

  private async autoApprove(version: PendingVersion, now: Date) {
    const { milestone } = version;
    try {
      await this.stellar.releaseMilestonePayment(milestone.engagementId, milestone.milestoneIndex);
    } catch (error) {
      // Release the claim so the next run retries the payout.
      await this.prisma.milestoneProofVersion.update({ where: { id: version.id }, data: { slaExpiredAt: null } });
      throw error;
    }

    await this.milestones.markConfirmed(milestone.engagementId, milestone.milestoneIndex, BigInt(milestone.amount || 0));
    await this.prisma.milestoneProofVersion.update({
      where: { id: version.id },
      data: { status: ProofVersionStatus.APPROVED, reviewedAt: now, reviewedById: null },
    });

    const data = {
      engagementId: milestone.engagementId,
      milestoneIndex: milestone.milestoneIndex,
      versionNumber: version.versionNumber,
      autoApproved: true,
    };
    await this.notifications.notifyUser(
      milestone.engagement.companyAddress,
      NotificationType.PROOF_SLA_ESCALATED,
      'Proof auto-approved',
      `The review window for milestone ${milestone.milestoneIndex} on engagement ${milestone.engagementId} ` +
        'expired, so the proof was approved automatically and the payment released.',
      data,
    );
    await this.notifications.notifyUser(
      milestone.engagement.recruiterAddress,
      NotificationType.PAYMENT_RELEASED,
      'Payment released',
      `Milestone ${milestone.milestoneIndex} on engagement ${milestone.engagementId} was approved after the ` +
        'company review window expired.',
      data,
    );
  }

  private async escalate(version: PendingVersion, slaDays: number) {
    const { milestone } = version;
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, deactivatedAt: null },
      select: { id: true },
    });
    const data = {
      engagementId: milestone.engagementId,
      milestoneId: milestone.id,
      milestoneIndex: milestone.milestoneIndex,
      versionNumber: version.versionNumber,
      submittedAt: version.submittedAt,
    };

    for (const admin of admins) {
      await this.notifications.notifyUserById(
        admin.id,
        NotificationType.PROOF_SLA_ESCALATED,
        'Proof review SLA breached',
        `Proof for milestone ${milestone.milestoneIndex} on engagement ${milestone.engagementId} has gone ` +
          `unreviewed for more than ${slaDays} days.`,
        data,
      );
    }
    await this.notifications.notifyUser(
      milestone.engagement.companyAddress,
      NotificationType.PROOF_SLA_ESCALATED,
      'Proof review escalated',
      `Your ${slaDays}-day review window for milestone ${milestone.milestoneIndex} on engagement ` +
        `${milestone.engagementId} expired and the proof has been escalated to an admin.`,
      data,
    );
  }
}

interface PendingVersion {
  id: string;
  versionNumber: number;
  submittedAt: Date;
  reminder50SentAt: Date | null;
  reminder90SentAt: Date | null;
  milestone: {
    id: string;
    engagementId: string;
    milestoneIndex: number;
    amount: bigint | null;
    engagement: {
      companyAddress: string;
      recruiterAddress: string;
      company: { id: string; proofSlaDays: number; proofSlaAction: ProofSlaAction } | null;
    };
  };
}
