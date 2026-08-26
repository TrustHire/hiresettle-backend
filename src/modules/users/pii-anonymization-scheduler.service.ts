import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';

/**
 * How many accounts are processed per scheduler run.
 * Keeps individual transactions short and avoids long table locks.
 */
const BATCH_SIZE = 100;

/**
 * PiiAnonymizationSchedulerService
 *
 * Runs daily at 04:00 UTC (after the 03:00 purgeExpiredRecords cron in
 * GdprService). Finds User records where:
 *
 *   • deletedAt IS NOT NULL           — erasure was requested
 *   • anonymizedAt IS NULL            — full PII scrub has not yet run
 *   • deletedAt < now() - window      — the configured retention window has elapsed
 *
 * For each matching account the job:
 *   1. Nulls all remaining PII / credential fields on the User row.
 *   2. Deletes the S3 avatar object (if present).
 *   3. Hard-deletes Notification and NotificationPreference rows (personal data
 *      with no financial/audit significance).
 *   4. Revokes all active RefreshToken rows (prevents any stale session reuse).
 *   5. Nulls the ip / userAgent columns on linked SecurityEvent rows (keeps the
 *      action + timestamp for audit while removing network identifiers).
 *   6. Sets anonymizedAt to record completion.
 *
 * Fields deliberately preserved:
 *   • stellarAddress — used as a foreign-key join key on Engagement rows;
 *     removing it would break on-chain financial history.
 *   • id, role, createdAt, deletedAt, deactivatedAt — non-PII operational fields.
 *   • EngagementAuditLog / MilestoneAuditLog / AuditLog rows — financial/audit
 *     records that reference the user by ID (not by name/email).
 *   • Engagement, Milestone, ChainEvent rows — on-chain records; immutable.
 *
 * Configuration (env vars):
 *   PII_ANONYMIZATION_WINDOW_DAYS  — days after deletedAt before the job fires
 *                                    (default: 30)
 *   DATA_RETENTION_DAYS            — used by the sibling purgeExpiredRecords cron;
 *                                    documented here for completeness (default: 365)
 */
@Injectable()
export class PiiAnonymizationSchedulerService {
  private readonly logger = new Logger(PiiAnonymizationSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly s3: S3Service,
  ) {}

  // -------------------------------------------------------------------------
  // Scheduled entry point — 04:00 UTC daily
  // -------------------------------------------------------------------------

  @Cron('0 4 * * *', { timeZone: 'UTC', name: 'pii-anonymization' })
  async handleScheduledAnonymization(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('PII anonymization job already running — skipping this tick');
      return;
    }
    this.isRunning = true;

    this.logger.log('PII anonymization job started');

    try {
      const processed = await this.anonymizeDueAccounts();
      this.logger.log(`PII anonymization job completed — ${processed} account(s) anonymized`);
    } catch (err) {
      this.logger.error('PII anonymization job failed with an unhandled error', err);
    } finally {
      this.isRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Core logic — callable independently (e.g. from an admin endpoint or test)
  // -------------------------------------------------------------------------

  /**
   * Anonymize all accounts whose erasure window has elapsed.
   * Returns the number of accounts successfully anonymized.
   */
  async anonymizeDueAccounts(): Promise<number> {
    const windowDays = this.config.get<number>('PII_ANONYMIZATION_WINDOW_DAYS', 30);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    // Work in batches to keep individual DB transactions short.
    let totalProcessed = 0;
    let batch: { id: string; avatarUrl: string | null }[];

    do {
      batch = await this.prisma.user.findMany({
        where: {
          deletedAt: { not: null, lt: cutoff },
          anonymizedAt: null,
        },
        select: { id: true, avatarUrl: true },
        take: BATCH_SIZE,
        // Stable ordering so a mid-run crash doesn't re-process already-handled
        // accounts when the job restarts (they will have anonymizedAt set).
        orderBy: { deletedAt: 'asc' },
      });

      for (const user of batch) {
        try {
          await this.anonymizeUser(user.id, user.avatarUrl);
          totalProcessed++;
        } catch (err) {
          // Log and continue — a single failure must not abort the whole batch.
          this.logger.error(
            `Failed to anonymize user ${user.id} — will retry on next run`,
            err,
          );
        }
      }
    } while (batch.length === BATCH_SIZE);

    return totalProcessed;
  }

  // -------------------------------------------------------------------------
  // Per-account anonymization — wrapped in a single transaction
  // -------------------------------------------------------------------------

  /**
   * Wipes all PII and credentials for one user account.
   *
   * The S3 avatar deletion is performed *outside* the Prisma transaction
   * because S3 is not transactional. If the DB transaction succeeds but S3
   * deletion fails the job logs a warning and continues — the S3CleanupService
   * orphan-cleanup cron will eventually remove the object once avatarUrl is
   * nulled in the DB.
   */
  async anonymizeUser(userId: string, avatarUrl: string | null): Promise<void> {
    // S3 avatar deletion — best-effort, before the DB update so the URL is
    // still available if we need to retry.
    if (avatarUrl) {
      await this.deleteAvatar(userId, avatarUrl);
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Wipe PII and credential fields on the User row.
      //    stellarAddress is intentionally preserved (on-chain FK integrity).
      await tx.user.update({
        where: { id: userId },
        data: {
          // Identity PII
          email: null,
          name: null,
          company: null,
          avatarUrl: null,
          // Credentials / secrets
          passwordHash: null,
          webhookUrl: null,
          webhookSecret: null,
          totpSecret: null,
          totpEnabled: false,
          // Operational state — reset to safe defaults
          failedLoginAttempts: 0,
          lockedUntil: null,
          rateLimitOverride: null,
          // Completion marker
          anonymizedAt: new Date(),
        },
      });

      // 2. Revoke all refresh tokens — prevents any stale session reuse.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // 3. Delete notifications — personal-content records with no
      //    financial or audit significance.
      await tx.notification.deleteMany({ where: { userId } });

      // 4. Delete notification preferences — personal settings.
      await tx.notificationPreference.deleteMany({ where: { userId } });

      // 5. Null network identifiers on SecurityEvent rows.
      //    Preserves the action and timestamp for audit/compliance while
      //    removing ip and userAgent which are personal data under GDPR.
      await tx.securityEvent.updateMany({
        where: { userId },
        data: { ip: null, userAgent: null },
      });
    });

    this.logger.log(`Anonymized PII for user ${userId}`);
  }

  // -------------------------------------------------------------------------
  // S3 helpers
  // -------------------------------------------------------------------------

  private async deleteAvatar(userId: string, avatarUrl: string): Promise<void> {
    try {
      // avatarUrl is a full CDN/presigned URL; extract the S3 object key from
      // the path component (everything after the bucket host).
      const key = this.extractS3Key(avatarUrl);
      if (key) {
        await this.s3.deleteObject(key);
        this.logger.debug(`Deleted S3 avatar for user ${userId}: ${key}`);
      }
    } catch (err) {
      // Non-fatal — S3CleanupService will remove the orphaned object later.
      this.logger.warn(
        `Could not delete S3 avatar for user ${userId} (${avatarUrl}) — ` +
          `S3CleanupService will handle it: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Extract the S3 object key from a full URL.
   *
   * Handles two common URL shapes:
   *   https://<bucket>.s3.<region>.amazonaws.com/<key>
   *   https://<custom-endpoint>/<bucket>/<key>
   *
   * Returns null when the key cannot be reliably determined so we fall back to
   * the orphan-cleanup approach rather than risk deleting the wrong object.
   */
  private extractS3Key(url: string): string | null {
    try {
      const parsed = new URL(url);
      // pathname starts with '/'; strip it
      const pathname = parsed.pathname.replace(/^\//, '');

      // If the host contains the bucket name (virtual-hosted style) the entire
      // pathname is the key.  Otherwise the first path segment is the bucket
      // and the rest is the key.
      const bucket = this.config.get<string>('S3_BUCKET', '');
      if (parsed.hostname.startsWith(`${bucket}.`)) {
        return pathname || null;
      }

      // Path-style: /<bucket>/<key...>
      const parts = pathname.split('/');
      if (parts[0] === bucket && parts.length > 1) {
        return parts.slice(1).join('/') || null;
      }

      // Unable to determine key safely
      return null;
    } catch {
      return null;
    }
  }
}
