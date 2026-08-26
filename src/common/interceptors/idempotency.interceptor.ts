import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';

/**
 * IdempotencyInterceptor — drop-in protection against duplicate POST submissions.
 *
 * Behaviour:
 *  - Only activates when the route handler carries the @Idempotent() metadata
 *    AND the client sends an `Idempotency-Key` header.
 *  - On the first request: lets the handler run normally, then caches the
 *    response against (key, userId) for 24 h.
 *  - On retry (same key + same user within 24 h): returns the cached response
 *    immediately without invoking the handler again.
 *  - If no key header is present the interceptor is transparent (no-op).
 *
 * Must be applied at module or controller level together with @Idempotent() on
 * each route that should be protected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Only activate on handlers decorated with @Idempotent()
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isIdempotent) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    // NestJS / Express normalise header names to lowercase
    const idempotencyKey: string | undefined = req.headers['idempotency-key'];

    if (!idempotencyKey) {
      return next.handle();
    }

    const userId: string | undefined = req.user?.id;
    if (!userId) {
      // No authenticated user — cannot namespace the key; pass through
      return next.handle();
    }

    // Delegate cache lookup → handler → cache store
    return from(this.idempotency.checkAndReturn(idempotencyKey, userId)).pipe(
      switchMap((cached) => {
        if (cached !== null) {
          this.logger.debug(
            `Idempotency cache hit — key="${idempotencyKey}" userId="${userId}"`,
          );
          return of(cached);
        }

        // Cache miss: run the handler, then store the result
        return next.handle().pipe(
          tap(async (result) => {
            try {
              await this.idempotency.store(idempotencyKey, userId, result);
            } catch (err) {
              // Storing the cache entry is best-effort — a failure here must
              // not surface as an error to the client since the primary
              // operation already succeeded.
              this.logger.warn(
                `Failed to store idempotency cache entry — key="${idempotencyKey}": ${err}`,
              );
            }
          }),
        );
      }),
    );
  }
}
