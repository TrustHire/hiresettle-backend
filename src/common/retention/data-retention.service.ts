import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Per-category retention configuration
// ---------------------------------------------------------------------------

/**
 * Each category maps to one or more Prisma delete operations.
 *
 * Env var name conventions (all default in parentheses):
 *   RETENTION_NOTIFICATIONS_DAYS        — read notifications    (90)
 *   RETENTION_NOTIFICATIONS_UNREAD_DAYS — unread notifications  (365)
 *   RETENTION_SECURITY_EVENTS_DAYS      — security_events rows  (365)
 *   RETENTION_IDEMPOTENCY_KEYS_DAYS     — expired idempotency_keys rows (0 = use expiresAt)
 *   RETENTION_REFRESH_TOKENS_DAYS       — consumed/revoked/expired refresh_tokens rows (30)
 *   RETENTION_DATA_DELETION_REQS_DAYS   — processed data_deletion_requests rows (365)
 *
 * A value of 0 for RETENTION_IDEMPOTENCY_KEYS_DAYS is special: it uses the
 * per-row expiresAt field instead of a fixed window (the correct behaviour).
 */

export interface RetentionSummary {
  ranAt: Date;
  durationMs: number;
  categories: Record<string, CategoryResult>;
  totalDeleted: number;
  errors: string[];
}

export interface CategoryResult {
  deleted: number;
  skipped: boolean; // true when window is set to -1 (disabled)
  error?: string;
}

// Sentinel: set a window to -1 to disable a category entirely.
const DISABLED = -1;

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Scheduled entry point — 03:00 UTC daily
  //
  // Runs at the same slot that GdprService.purgeExpiredRecords used to occupy.
  // GdprService.purgeExpiredRecords is stripped of its @Cron and now delegates
  // here so there is exactly one scheduled job for all category deletions.
  // -------------------------------------------------------------------------

  @Cron('0 3 * * *', { timeZone: 'UTC', name: 'data-retention' })
  async handleScheduledRetention(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Data retention job already running — skipping this tick');
      return;
    }
    this.isRunning = true;
    this.logger.log('Data retention job started');

    try {
      const summary = await this.enforceRetention();
      this.logSummary(summary);
    } catch (err) {
      this.logger.error('Data retention job failed with an unhandled error', err);
    } finally {
      this.isRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Core enforcement — callable from admin endpoints or tests
  // -------------------------------------------------------------------------

  /**
   * Run all configured retention categories and return a structured summary.
   *
   * Each category is independent: a failure in one does not prevent the others
   * from running.
   */
  async enforceRetention(): Promise<RetentionSummary> {
    const startedAt = Date.now();
    const ranAt = new Date();
    const categories: Record<string, CategoryResult> = {};
    const errors: string[] = [];

    // Run each category, collecting results regardless of individual failures.
    const runners: Array<[string, () => Promise<number>]> = [
      ['notifications.read', () => this.purgeReadNotifications()],
      ['notifications.unread', () => this.purgeUnreadNotifications()],
      ['security_events', () => this.purgeSecurityEvents()],
      ['idempotency_keys', () => this.purgeExpiredIdempotencyKeys()],
      ['refresh_tokens', () => this.purgeStaleRefreshTokens()],
      ['data_deletion_requests', () => this.purgeProcessedDeletionRequests()],
    ];

    for (const [name, runner] of runners) {
      try {
        const deleted = await runner();
        if (deleted === DISABLED) {
          categories[name] = { deleted: 0, skipped: true };
        } else {
          categories[name] = { deleted, skipped: false };
        }
      } catch (err: any) {
        const message = err?.message ?? String(err);
        categories[name] = { deleted: 0, skipped: false, error: message };
        errors.push(`${name}: ${message}`);
        this.logger.error(`Retention category "${name}" failed`, err);
      }
    }

    const totalDeleted = Object.values(categories).reduce(
      (sum, r) => sum + r.deleted,
      0,
    );

    return {
      ranAt,
      durationMs: Date.now() - startedAt,
      categories,
      totalDeleted,
      errors,
    };
  }

  // -------------------------------------------------------------------------
  // Category implementations
  // -------------------------------------------------------------------------

  /**
   * Read notifications older than RETENTION_NOTIFICATIONS_DAYS.
   *
   * Default: 90 days. Matches legacy NotificationCleanupService behaviour.
   * Set to -1 to disable.
   */
  private async purgeReadNotifications(): Promise<number> {
    const days = this.config.get<number>('RETENTION_NOTIFICATIONS_DAYS', 90);
    if (days === DISABLED) return DISABLED;

    const cutoff = this.daysAgo(days);
    const { count } = await this.prisma.notification.deleteMany({
      where: { read: true, createdAt: { lt: cutoff } },
    });
    return count;
  }

  /**
   * Unread notifications older than RETENTION_NOTIFICATIONS_UNREAD_DAYS.
   *
   * Default: 365 days. Unread notifications survive longer than read ones;
   * they are still deleted once they are truly stale.
   * Set to -1 to disable (keeps unread notifications indefinitely).
   */
  private async purgeUnreadNotifications(): Promise<number> {
    const days = this.config.get<number>('RETENTION_NOTIFICATIONS_UNREAD_DAYS', 365);
    if (days === DISABLED) return DISABLED;

    const cutoff = this.daysAgo(days);
    const { count } = await this.prisma.notification.deleteMany({
      where: { read: false, createdAt: { lt: cutoff } },
    });
    return count;
  }

  /**
   * Security events older than RETENTION_SECURITY_EVENTS_DAYS.
   *
   * Default: 365 days. Matches legacy GdprService.purgeExpiredRecords behaviour.
   * Set to -1 to disable.
   */
  private async purgeSecurityEvents(): Promise<number> {
    const days = this.config.get<number>('RETENTION_SECURITY_EVENTS_DAYS', 365);
    if (days === DISABLED) return DISABLED;

    const cutoff = this.daysAgo(days);
    const { count } = await this.prisma.securityEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }

  /**
   * Expired idempotency keys (expiresAt < now).
   *
   * Uses the per-row expiresAt field — no configurable window needed.
   * RETENTION_IDEMPOTENCY_KEYS_DAYS is only used to disable this category (-1).
   * Expired keys are safe to delete immediately once their TTL has passed.
   */
  private async purgeExpiredIdempotencyKeys(): Promise<number> {
    const enabled = this.config.get<number>('RETENTION_IDEMPOTENCY_KEYS_DAYS', 0);
    if (enabled === DISABLED) return DISABLED;

    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  /**
   * Stale refresh tokens: consumed, revoked, OR past their expiresAt,
   * older than RETENTION_REFRESH_TOKENS_DAYS from their creation date.
   *
   * Default: 30 days. Active (unconsumed, unrevoked, not yet expired) tokens
   * are never touched regardless of age.
   * Set to -1 to disable.
   */
  private async purgeStaleRefreshTokens(): Promise<number> {
    const days = this.config.get<number>('RETENTION_REFRESH_TOKENS_DAYS', 30);
    if (days === DISABLED) return DISABLED;

    const cutoff = this.daysAgo(days);
    const now = new Date();

    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [
          { consumedAt: { not: null } },
          { revokedAt: { not: null } },
          { expiresAt: { lt: now } },
        ],
      },
    });
    return count;
  }

  /**
   * Processed DataDeletionRequest rows older than
   * RETENTION_DATA_DELETION_REQS_DAYS since their requestedAt date.
   *
   * Default: 365 days. Only processed requests (processedAt IS NOT NULL) are
   * eligible — pending requests are never deleted.
   * Set to -1 to disable.
   */
  private async purgeProcessedDeletionRequests(): Promise<number> {
    const days = this.config.get<number>('RETENTION_DATA_DELETION_REQS_DAYS', 365);
    if (days === DISABLED) return DISABLED;

    const cutoff = this.daysAgo(days);
    const { count } = await this.prisma.dataDeletionRequest.deleteMany({
      where: {
        processedAt: { not: null },
        requestedAt: { lt: cutoff },
      },
    });
    return count;
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  private logSummary(summary: RetentionSummary): void {
    const lines: string[] = [
      `Data retention job completed in ${summary.durationMs}ms`,
      `Total records deleted: ${summary.totalDeleted}`,
    ];

    for (const [name, result] of Object.entries(summary.categories)) {
      if (result.skipped) {
        lines.push(`  [${name}] skipped (disabled)`);
      } else if (result.error) {
        lines.push(`  [${name}] ERROR — ${result.error}`);
      } else {
        lines.push(`  [${name}] deleted ${result.deleted}`);
      }
    }

    if (summary.errors.length > 0) {
      this.logger.warn(lines.join('\n'));
    } else {
      this.logger.log(lines.join('\n'));
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }
}
