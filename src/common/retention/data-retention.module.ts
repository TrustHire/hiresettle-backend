import { Module } from '@nestjs/common';
import { DataRetentionService } from './data-retention.service';

/**
 * DataRetentionModule
 *
 * Registers DataRetentionService, which owns the single daily cron (03:00 UTC)
 * responsible for enforcing all configurable per-category retention windows:
 *
 *   • read notifications         (RETENTION_NOTIFICATIONS_DAYS)
 *   • unread notifications       (RETENTION_NOTIFICATIONS_UNREAD_DAYS)
 *   • security events            (RETENTION_SECURITY_EVENTS_DAYS)
 *   • expired idempotency keys   (RETENTION_IDEMPOTENCY_KEYS_DAYS)
 *   • stale refresh tokens       (RETENTION_REFRESH_TOKENS_DAYS)
 *   • processed deletion reqs    (RETENTION_DATA_DELETION_REQS_DAYS)
 *
 * PrismaService and ConfigService are provided globally, so no extra imports
 * are needed here.
 *
 * Import this module at the AppModule level only — registering it inside a
 * feature module would duplicate the @Cron registration.
 */
@Module({
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
