import { applyDecorators } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Mark a POST route handler as idempotency-aware.
 *
 * Applying this decorator does two things:
 *  1. Sets NestJS route metadata that IdempotencyInterceptor reads to activate
 *     cache-lookup / cache-store behaviour for the request.
 *  2. Adds an `Idempotency-Key` entry to the Swagger UI so clients know the
 *     header is supported.
 *
 * Usage:
 *   @Post()
 *   @Idempotent()
 *   create(...) { ... }
 */
export function Idempotent() {
  return applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Client-generated UUID. When supplied, a duplicate request with the same key ' +
        'and authenticated user returns the original response instead of reprocessing.',
    }),
  );
}
