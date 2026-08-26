import { Injectable, Logger } from '@nestjs/common';

/**
 * NotificationCleanupService
 *
 * This service previously owned a 02:00 UTC cron that deleted read
 * notifications older than NOTIFICATION_RETENTION_DAYS. That logic has been
 * consolidated into DataRetentionService (src/common/retention/), which runs
 * at 03:00 UTC and handles all data categories — including read notifications
 * (RETENTION_NOTIFICATIONS_DAYS) and unread notifications
 * (RETENTION_NOTIFICATIONS_UNREAD_DAYS) — under a single scheduled job with
 * a structured per-run summary log.
 *
 * This stub is kept so nothing breaks if other services reference it by token,
 * but it no longer schedules or deletes anything itself.
 *
 * See: src/common/retention/data-retention.service.ts
 */
@Injectable()
export class NotificationCleanupService {
  private readonly logger = new Logger(NotificationCleanupService.name);

  constructor() {
    this.logger.debug(
      'NotificationCleanupService loaded (cron superseded by DataRetentionService)',
    );
  }
}
