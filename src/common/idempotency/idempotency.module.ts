import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Provides the shared IdempotencyService to any feature module that imports it.
 * PrismaService is globally available (PrismaModule is @Global), so no need to
 * re-import PrismaModule here.
 */
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
