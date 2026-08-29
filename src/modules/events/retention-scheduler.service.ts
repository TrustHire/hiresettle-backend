import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/prisma/prisma.service";
import { StellarService } from "../../common/stellar/stellar.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "@prisma/client";

/**
 * RetentionSchedulerService
 *
 * This is the HireSettle-specific cron service — the key difference from
 * ChainSettle. It runs two jobs:
 *
 * 1. APPROACHING NOTIFICATION (every hour)
 *    Finds RetentionSchedule records where notifyAt <= now and notified = false.
 *    Sends a "retention window approaching" notification to both company and recruiter
 *    (e.g. "30-day window ends in 3 days — be ready to confirm").
 *
 * 2. AUTO-UNLOCK (every 10 minutes)
 *    Finds RetentionSchedule records where unlockAt <= now and unlocked = false.
 *    Calls is_milestone_unlockable() on the Stellar RPC to confirm the ledger has passed.
 *    If yes, records the milestone as ready for the frontend to call unlock_milestone() on-chain.
 *    Also notifies the recruiter that they can now submit proof.
 *
 * The actual unlock_milestone() on-chain call is intentionally left to the frontend
 * (the recruiter clicks "Submit proof" which triggers it). This avoids the backend
 * needing a funded Stellar account for write operations.
 *
 * Production note: Replace the in-memory lastProcessedLedger in EventsService with
 * a DB-persisted value so this scheduler survives server restarts correctly.
 */
@Injectable()
export class RetentionSchedulerService {
  private readonly logger = new Logger(RetentionSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------
  // APPROACHING NOTIFICATION — runs every hour
  // ----------------------------------------------------------

  private isWithinLocalHours(userTimezone: string | null | undefined) {
    const tz = userTimezone || "UTC";
    const localHour = new Date().toLocaleString("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    const hour = Number(localHour);
    return hour >= 9 && hour <= 18;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendApproachingNotifications() {
    const now = new Date();

    const dueSoon = await this.prisma.retentionSchedule.findMany({
      where: {
        notifyAt: { lte: now },
        notified: false,
        unlocked: false,
      },
    });

    if (!dueSoon.length) return;

    this.logger.log(
      `Sending ${dueSoon.length} retention-approaching notification(s)`,
    );

    for (const schedule of dueSoon) {
      try {
        const engagement = await this.prisma.engagement.findUnique({
          where: { id: schedule.engagementId },
          include: {
            milestones: {
              where: { milestoneIndex: schedule.milestoneIndex },
            },
          },
        });

        if (!engagement) continue;

        const milestone = engagement.milestones[0];
        const daysLabel = milestone?.retentionDays
          ? `${milestone.retentionDays}-day`
          : "retention";

        const message = `The ${daysLabel} retention window for engagement ${engagement.id} (${engagement.jobTitle}) closes in approximately 3 days. Be ready to confirm when the milestone unlocks.`;

        const users = await this.prisma.user.findMany({
          where: {
            stellarAddress: {
              in: [engagement.companyAddress, engagement.recruiterAddress],
            },
          },
          select: { stellarAddress: true, timezone: true },
        });

        for (const user of users) {
          if (!this.isWithinLocalHours(user.timezone)) continue;
          await this.notifications.notifyUser(
            user.stellarAddress,
            NotificationType.RETENTION_WINDOW_APPROACHING,
            `${daysLabel} retention window closing soon`,
            message,
            {
              engagementId: engagement.id,
              milestoneIndex: schedule.milestoneIndex,
              unlockAt: schedule.unlockAt,
            },
          );
        }

        await this.prisma.retentionSchedule.update({
          where: { id: schedule.id },
          data: { notified: true },
        });
      } catch (error) {
        this.logger.error(
          `Failed to send approaching notification for ${schedule.engagementId}`,
          error.message,
        );
      }
    }
  }

  // ----------------------------------------------------------
  // AUTO-UNLOCK CHECK — runs every 10 minutes
  // ----------------------------------------------------------

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkAndMarkUnlockable() {
    const now = new Date();

    const dueForUnlock = await this.prisma.retentionSchedule.findMany({
      where: {
        unlockAt: { lte: now },
        unlocked: false,
      },
    });

    if (!dueForUnlock.length) return;

    this.logger.log(
      `Checking ${dueForUnlock.length} milestone(s) for on-chain unlock`,
    );

    for (const schedule of dueForUnlock) {
      try {
        const isUnlockable = await this.stellar.isMilestoneUnlockable(
          schedule.engagementId,
          schedule.milestoneIndex,
        );

        if (!isUnlockable) {
          this.logger.debug(
            `Milestone ${schedule.milestoneIndex} on ${schedule.engagementId} not yet unlockable on-chain (ledger lag)`,
          );
          continue;
        }

        // Update local DB — mark the milestone as PENDING so UI shows it
        await this.prisma.milestone.updateMany({
          where: {
            engagementId: schedule.engagementId,
            milestoneIndex: schedule.milestoneIndex,
            status: "LOCKED",
          },
          data: { status: "PENDING" },
        });

        await this.prisma.retentionSchedule.update({
          where: { id: schedule.id },
          data: { unlocked: true },
        });

        // Notify recruiter — they can now submit proof
        const engagement = await this.prisma.engagement.findUnique({
          where: { id: schedule.engagementId },
          include: {
            milestones: { where: { milestoneIndex: schedule.milestoneIndex } },
          },
        });

        if (engagement) {
          const milestone = engagement.milestones[0];
          const daysLabel = milestone?.retentionDays
            ? `${milestone.retentionDays}-day`
            : "Retention";

          await this.notifications.notifyUser(
            engagement.recruiterAddress,
            NotificationType.MILESTONE_UNLOCKED,
            `${daysLabel} retention milestone unlocked`,
            `The ${daysLabel} retention milestone for engagement ${engagement.id} (${engagement.jobTitle}) is now unlocked. Submit your proof to claim your payment.`,
            {
              engagementId: engagement.id,
              milestoneIndex: schedule.milestoneIndex,
            },
          );
        }

        this.logger.log(
          `Marked milestone ${schedule.milestoneIndex} on ${schedule.engagementId} as PENDING (unlocked)`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process unlock for ${schedule.engagementId}[${schedule.milestoneIndex}]`,
          error.message,
        );
      }
    }
  }
}
