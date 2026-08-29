import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, MilestoneKind } from '@prisma/client';

/**
 * PlacementReminderSchedulerService (#260)
 *
 * Sends a one-off "placement milestone due soon" notification to the recruiter
 * N days before a PLACEMENT milestone's expected proof-submission date
 * (stored on Milestone.placementDueAt).
 *
 * The reminder window is configurable via the PLACEMENT_MILESTONE_REMINDER_DAYS
 * environment variable (default: 7 days).
 *
 * Each milestone is reminded at most once — tracked by Milestone.reminderSent.
 *
 * Runs every hour; query is cheap thanks to the partial index on
 * (placementDueAt, reminderSent) WHERE reminderSent = false.
 */
@Injectable()
export class PlacementReminderSchedulerService {
  private readonly logger = new Logger(PlacementReminderSchedulerService.name);
  private readonly reminderDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {
    this.reminderDays = this.config.get<number>('PLACEMENT_MILESTONE_REMINDER_DAYS', 7);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendPlacementReminders() {
    if (this.reminderDays <= 0) return; // disabled via env

    const now = new Date();
    const reminderThreshold = new Date(now.getTime() + this.reminderDays * 24 * 60 * 60 * 1000);

    // Find PLACEMENT milestones whose due date falls within the reminder window
    // and whose reminder has not yet been sent.
    const dueSoon = await this.prisma.milestone.findMany({
      where: {
        kind: MilestoneKind.PLACEMENT,
        placementDueAt: {
          gt: now,              // not already overdue
          lte: reminderThreshold,
        },
        reminderSent: false,
      },
      include: {
        engagement: {
          select: {
            id: true,
            jobTitle: true,
            recruiterAddress: true,
          },
        },
      },
    });

    if (!dueSoon.length) return;

    this.logger.log(`Sending ${dueSoon.length} placement milestone due-soon reminder(s)`);

    for (const milestone of dueSoon) {
      try {
        const engagement = milestone.engagement;

        const dueDate = milestone.placementDueAt!.toISOString().slice(0, 10);
        const message =
          `Reminder: the placement milestone "${milestone.name}" for engagement ` +
          `"${engagement.jobTitle}" (${engagement.id}) is due on ${dueDate} ` +
          `(in ${this.reminderDays} days). Please prepare your proof of placement.`;

        await this.notifications.notifyUser(
          engagement.recruiterAddress,
          NotificationType.PLACEMENT_MILESTONE_DUE_SOON,
          `Placement milestone due soon — ${engagement.jobTitle}`,
          message,
          {
            engagementId: engagement.id,
            milestoneId: milestone.id,
            milestoneIndex: milestone.milestoneIndex,
            placementDueAt: milestone.placementDueAt,
          },
        );

        // Mark as reminded so we don't send again
        await this.prisma.milestone.update({
          where: { id: milestone.id },
          data: { reminderSent: true },
        });

        this.logger.log(
          `Placement reminder sent for milestone ${milestone.id} on engagement ${engagement.id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send placement reminder for milestone ${milestone.id}`,
          error.message,
        );
      }
    }
  }
}
