import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export const RateLimit = (limit: number, ttlSeconds: number) =>
    applyDecorators(
        Throttle({ default: { limit, ttl: ttlSeconds } })
    );

