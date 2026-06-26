import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { MilestoneStatus } from '@prisma/client';

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  async findByEngagement(engagementId: string) {
    return this.prisma.milestone.findMany({
      where: { engagementId },
      orderBy: { milestoneIndex: 'asc' },
    });
  }

  async findOne(engagementId: string, milestoneIndex: number) {
    const m = await this.prisma.milestone.findUnique({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
    });
    if (!m) throw new NotFoundException(
      `Milestone ${milestoneIndex} not found on engagement ${engagementId}`,
    );
    return m;
  }

  /**
   * Get remaining days until a Locked milestone unlocks.
   * Queries the chain via is_milestone_unlockable() and ledgers_until_unlock().
   */
  async getRetentionTimer(engagementId: string, milestoneIndex: number) {
    const milestone = await this.findOne(engagementId, milestoneIndex);
    const unlockable = await this.stellar.isMilestoneUnlockable(engagementId, milestoneIndex);

    if (unlockable) {
      return { daysRemaining: 0, ledgersRemaining: 0, unlockable: true };
    }

    const ledgersRemaining = await this.stellar.ledgersUntilUnlock(engagementId, milestoneIndex);
    const daysRemaining = this.stellar.ledgersToDays(ledgersRemaining);

    return {
      daysRemaining,
      ledgersRemaining,
      unlockable: false,
      estimatedUnlockAt: milestone.unlockEstimatedAt,
    };
  }

  // ----------------------------------------------------------
  // Core Business/Validation Methods
  // ----------------------------------------------------------

  async getCurrentLedgerSequence(): Promise<number> {
    return this.stellar.getCurrentLedgerSequence();
  }

  async findActiveRetentionMilestones() {
    return this.prisma.milestone.findMany({
      where: {
        kind: 'RETENTION',
        status: MilestoneStatus.LOCKED,
      },
    });
  }

  async unlockRetentionOnChain(milestoneId: string): Promise<void> {
    const milestone = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone) return;

    try {
      const txHash = await this.stellar.unlockRetentionMilestone(
        milestone.engagementId,
        milestone.milestoneIndex,
      );

      await this.prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.PENDING },
      });

      await this.prisma.retentionSchedule.updateMany({
        where: {
          engagementId: milestone.engagementId,
          milestoneIndex: milestone.milestoneIndex,
        },
        data: { unlocked: true },
      });
    } catch (error) {
      this.logger.error(`Failed executing on-chain unlock contract validation for milestone ${milestoneId}:`, error);
      throw error;
    }
  }

  async sendRetentionWarningNotification(milestoneId: string): Promise<void> {
    const milestone = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone) return;

    this.logger.log(`[Notification Sent] RETENTION_WINDOW_APPROACHING for milestone ${milestoneId}`);

    await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { approachingNotificationSent: true } as any, // fallback handling if field is implicit
    });

    await this.prisma.retentionSchedule.updateMany({
      where: {
        engagementId: milestone.engagementId,
        milestoneIndex: milestone.milestoneIndex,
      },
      data: { notified: true },
    });
  }

  async confirmMilestone(engagementId: string, milestoneIndex: number) {
    const milestone = await this.findOne(engagementId, milestoneIndex);
    const paymentReleased = BigInt(milestone.amount || 0);
    return this.markConfirmed(engagementId, milestoneIndex, paymentReleased);
  }

  // ----------------------------------------------------------
  // State update methods — called by EventsService
  // ----------------------------------------------------------

  async markUnlocked(engagementId: string, milestoneIndex: number) {
    return this.prisma.milestone.update({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      data: { status: MilestoneStatus.PENDING },
    });
  }

  async markProofSubmitted(engagementId: string, milestoneIndex: number, proofHash: string) {
    return this.prisma.milestone.update({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      data: { proofHash, status: MilestoneStatus.PROOF_SUBMITTED },
    });
  }

  async markConfirmed(engagementId: string, milestoneIndex: number, paymentReleased: bigint) {
    return this.prisma.milestone.update({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      data: {
        status: MilestoneStatus.CONFIRMED,
        paymentReleased,
        confirmedAt: new Date(),
      },
    });
  }

  async markDisputed(engagementId: string, milestoneIndex: number) {
    return this.prisma.milestone.update({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      data: { status: MilestoneStatus.DISPUTED },
    });
  }

  async markResolved(
    engagementId: string,
    milestoneIndex: number,
    approved: boolean,
    paymentReleased?: bigint,
  ) {
    return this.prisma.milestone.update({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      data: {
        status: approved ? MilestoneStatus.RESOLVED : MilestoneStatus.PENDING,
        ...(approved && paymentReleased ? { paymentReleased, confirmedAt: new Date() } : {}),
      },
    });
  }

  /**
   * Reset milestones after a replacement is requested.
   * Mirrors what the contract does on-chain: Placement → Pending,
   * unconfirmed Retention milestones → Locked with updated unlock estimates.
   */
  async resetForReplacement(engagementId: string, currentLedger: number) {
    const milestones = await this.findByEngagement(engagementId);

    for (const m of milestones) {
      if (m.kind === 'PLACEMENT') {
        await this.prisma.milestone.update({
          where: { id: m.id },
          data: {
            status: MilestoneStatus.PENDING,
            proofHash: null,
            confirmedAt: null,
            paymentReleased: null,
          },
        });
      } else if (
        m.kind === 'RETENTION' &&
        m.status !== MilestoneStatus.CONFIRMED &&
        m.status !== MilestoneStatus.RESOLVED
      ) {
        const newValidAfterLedger = m.retentionDays
          ? currentLedger + m.retentionDays * 17_280
          : m.validAfterLedger;

        const newUnlockAt = newValidAfterLedger
          ? this.stellar.ledgerToDateTime(newValidAfterLedger, currentLedger)
          : m.unlockEstimatedAt;

        await this.prisma.milestone.update({
          where: { id: m.id },
          data: {
            status: MilestoneStatus.LOCKED,
            proofHash: null,
            validAfterLedger: newValidAfterLedger,
            unlockEstimatedAt: newUnlockAt,
          },
        });

        // Update retention schedule so the cron job fires at the new time
        await this.prisma.retentionSchedule.upsert({
          where: { engagementId_milestoneIndex: { engagementId, milestoneIndex: m.milestoneIndex } },
          create: {
            engagementId,
            milestoneIndex: m.milestoneIndex,
            validAfterLedger: newValidAfterLedger!,
            unlockAt: newUnlockAt!,
            notifyAt: new Date(newUnlockAt!.getTime() - 3 * 24 * 60 * 60 * 1000),
          },
          update: {
            validAfterLedger: newValidAfterLedger!,
            unlockAt: newUnlockAt!,
            notifyAt: new Date(newUnlockAt!.getTime() - 3 * 24 * 60 * 60 * 1000),
            unlocked: false,
            notified: false,
          },
        });
      }
    }
  }
}
