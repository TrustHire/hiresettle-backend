import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

export interface WeeklyDigestSummary {
  ranAt: Date;
  optedIn: number;
  sent: number;
  skippedEmpty: number;
  errors: number;
  windowDays: number;
  durationMs: number;
}

interface DigestNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: Date;
}

/**
 * WeeklyDigestService
 *
 * Emails opted-in users a summary of their notifications from the prior
 * DIGEST_WINDOW_DAYS (default 7) on a weekly cron (Monday 09:00 UTC).
 *
 * Behaviour:
 *   • Only users with `digestEnabled = true` (and an email address) are considered.
 *   • Users with no notifications in the window receive nothing — empty digests
 *     are never sent.
 *   • A failure for one user is logged and does not stop the rest of the batch.
 *
 * The window is configurable via DIGEST_WINDOW_DAYS so the schedule can be
 * tuned without a code change; 7 is the default per the product spec (#276).
 */
@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);
  private isRunning = false;

  private static readonly TYPE_META: Partial<
    Record<NotificationType, { emoji: string; label: string }>
  > = {
    ENGAGEMENT_CREATED: { emoji: '🎉', label: 'Engagement created' },
    MILESTONE_UNLOCKED: { emoji: '🔓', label: 'Milestone unlocked' },
    PROOF_SUBMITTED: { emoji: '📄', label: 'Proof submitted' },
    MILESTONE_CONFIRMED: { emoji: '✅', label: 'Milestone confirmed' },
    PAYMENT_RELEASED: { emoji: '💰', label: 'Payment released' },
    DISPUTE_RAISED: { emoji: '⚠️', label: 'Dispute raised' },
    DISPUTE_RESOLVED: { emoji: '⚖️', label: 'Dispute resolved' },
    REPLACEMENT_REQUESTED: { emoji: '🔄', label: 'Replacement requested' },
    ENGAGEMENT_CANCELLED: { emoji: '❌', label: 'Engagement cancelled' },
    RETENTION_WINDOW_APPROACHING: { emoji: '⏰', label: 'Retention window approaching' },
    PLACEMENT_MILESTONE_DUE_SOON: { emoji: '📅', label: 'Milestone due soon' },
    ARBITER_ASSIGNED: { emoji: '⚖️', label: 'Arbiter assigned' },
    ARBITER_REASSIGNED: { emoji: '🔄', label: 'Arbiter reassigned' },
    ARBITER_RECUSAL_REQUESTED: { emoji: '🙋', label: 'Arbiter recusal requested' },
    ACCOUNT_MERGE_DETECTED: { emoji: '🔗', label: 'Account merge detected' },
    FUNDING_SHORTFALL_DETECTED: { emoji: '🚨', label: 'Funding shortfall detected' },
    STELLAR_BALANCE_LOW: { emoji: '⚠️', label: 'Stellar balance low' },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 9 * * 1', { timeZone: 'UTC', name: 'weekly-digest' })
  async handleWeeklyDigest(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Weekly digest job already running — skipping this tick');
      return;
    }
    this.isRunning = true;
    const startedAt = Date.now();
    this.logger.log('Weekly digest job started');

    try {
      const summary = await this.runWeeklyDigest();
      this.logger.log(
        `Weekly digest job completed in ${summary.durationMs}ms — ` +
          `optedIn=${summary.optedIn} sent=${summary.sent} ` +
          `skippedEmpty=${summary.skippedEmpty} errors=${summary.errors}`,
      );
    } catch (err) {
      this.logger.error('Weekly digest job failed with an unhandled error', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Core digest run — callable from tests or admin tooling. `since` overrides
   * the configurable window for deterministic testing.
   */
  async runWeeklyDigest(since?: Date): Promise<WeeklyDigestSummary> {
    const ranAt = new Date();
    const windowDays = this.config.get<number>('DIGEST_WINDOW_DAYS', 7);
    const windowStart = since ?? this.daysAgo(windowDays);

    const users = await this.prisma.user.findMany({
      where: {
        digestEnabled: true,
        email: { not: null },
        deletedAt: null,
        deactivatedAt: null,
      },
      select: { id: true, email: true, name: true },
    });

    let sent = 0;
    let skippedEmpty = 0;
    let errors = 0;

    for (const user of users) {
      try {
        const notifications = await this.prisma.notification.findMany({
          where: { userId: user.id, createdAt: { gte: windowStart } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            title: true,
            message: true,
            createdAt: true,
          },
        });

        // Acceptance criterion: users with no activity never get an empty digest.
        if (notifications.length === 0) {
          skippedEmpty++;
          continue;
        }

        const html = this.buildDigestHtml(user.name, notifications, windowStart, windowDays);
        await this.notifications.sendDigestEmail(
          user.email!,
          'Your weekly HireSettle digest',
          html,
        );
        sent++;
      } catch (error: any) {
        errors++;
        this.logger.error(
          `Weekly digest failed for user ${user.id}`,
          error?.message ?? String(error),
        );
      }
    }

    return {
      ranAt,
      optedIn: users.length,
      sent,
      skippedEmpty,
      errors,
      windowDays,
      durationMs: Date.now() - ranAt.getTime(),
    };
  }

  // -------------------------------------------------------------------------
  // Digest rendering
  // -------------------------------------------------------------------------

  private buildDigestHtml(
    userName: string | null,
    notifications: DigestNotification[],
    windowStart: Date,
    windowDays: number,
  ): string {
    // Group by notification type, preserving first-seen order.
    const groups = new Map<NotificationType, DigestNotification[]>();
    for (const n of notifications) {
      const bucket = groups.get(n.type);
      if (bucket) {
        bucket.push(n);
      } else {
        groups.set(n.type, [n]);
      }
    }

    const greeting = userName ? this.escapeHtml(userName) : 'there';
    const rangeLabel = `${this.formatDate(windowStart)} – ${this.formatDate(new Date())}`;

    const sections = [...groups.entries()]
      .map(([type, items]) => {
        const meta = WeeklyDigestService.TYPE_META[type];
        const emoji = meta?.emoji ?? '📬';
        const label = meta?.label ?? this.humanizeType(type);
        const rows = items
          .map(
            (item) =>
              `<li><strong>${this.escapeHtml(item.title)}</strong> — ${this.formatDate(item.createdAt)}<br>` +
              `<small>${this.escapeHtml(item.message)}</small></li>`,
          )
          .join('\n');
        return (
          `<h3>${emoji} ${this.escapeHtml(label)} (${items.length})</h3>\n` +
          `<ul style="margin:0 0 20px;padding-left:20px;">\n${rows}\n</ul>`
        );
      })
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your weekly HireSettle digest</title>
</head>
<body style="font-family:sans-serif;background:#f4f4f4;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;padding:20px;border-radius:8px;">
    <div style="background:#007bff;color:#fff;padding:10px 20px;border-radius:8px 8px 0 0;text-align:center;">
      <h1>HireSettle</h1>
    </div>
    <div style="padding:20px;color:#333;line-height:1.6;">
      <p>Hi ${greeting},</p>
      <p>Here's a summary of your activity on HireSettle over the last ${windowDays} days (${rangeLabel}):</p>
      ${sections}
      <p>You're receiving this digest because you opted in. You can turn it off anytime in your notification settings.</p>
    </div>
    <div style="text-align:center;padding:20px;font-size:12px;color:#777;">
      <p>&copy; ${new Date().getFullYear()} HireSettle. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  }

  private humanizeType(type: NotificationType): string {
    return type.toLowerCase().replace(/_/g, ' ');
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }
}
