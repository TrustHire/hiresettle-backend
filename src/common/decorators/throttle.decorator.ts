import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

/**
 * Helper decorator to keep throttling configuration consistent.
 */
export const RateLimit = (limit: number, ttlSeconds: number) =>
    applyDecorators(
        Throttle({ limit, ttl: ttlSeconds })
    );

