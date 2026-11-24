import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import {
  ThrottlerGuard,
  ThrottlerException,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  ThrottlerOptions,
  ThrottlerGetTrackerFunction,
  ThrottlerGenerateKeyFunction,
} from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

export interface ApiKeyLimits {
  id: string;
  rateLimit: number | null;
  monthlyQuota: number | null;
}

export interface QuotaUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
  /** Seconds until the quota resets (start of next UTC month). */
  resetSeconds: number;
}

/** "YYYY-MM" for the current UTC month. */
export function quotaPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function secondsUntilNextMonth(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

const REQ_API_KEY = Symbol('throttleApiKey');
const REQ_QUOTA_COUNTED = Symbol('throttleQuotaCounted');

/**
 * Per-caller throttling.
 *
 * - API-key requests are throttled per key: `ApiKey.rateLimit` per window
 *   (falls back to the global limit) and `ApiKey.monthlyQuota` per UTC month.
 *   Quota usage is returned in `X-RateLimit-Quota-*` headers.
 * - JWT requests are throttled per user (JWT sub), honouring `User.rateLimitOverride`.
 *
 * The API key is resolved from `req.user.apiKeyId` when an auth guard already
 * ran, or straight from the `X-Api-Key` header otherwise, so the guard works
 * regardless of guard order.
 */
@Injectable()
export class UserJwtSubThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const apiKey: ApiKeyLimits | undefined = req[REQ_API_KEY];
    if (apiKey) return `apikey:${apiKey.id}`;
    const sub = req.user?.id;
    return sub ? `sub:${sub}` : 'anonymous';
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: ThrottlerGetTrackerFunction,
    generateKey: ThrottlerGenerateKeyFunction,
  ): Promise<boolean> {
    const { req, res } = this.getRequestResponse(context);

    const apiKey = await this.resolveApiKey(req);
    if (apiKey) {
      req[REQ_API_KEY] = apiKey;
      // Short-window limit first, so a burst that is throttled does not burn monthly quota.
      const allowed = await super.handleRequest(
        context,
        apiKey.rateLimit ?? limit,
        ttl,
        throttler,
        getTracker,
        generateKey,
      );
      await this.consumeQuota(req, res, apiKey);
      return allowed;
    }

    const userId = req.user?.id;
    const effectiveLimit = userId ? await this.resolveUserLimit(userId, limit) : limit;
    return super.handleRequest(context, effectiveLimit, ttl, throttler, getTracker, generateKey);
  }

  /**
   * Atomically count this request against the key's monthly quota.
   * The counter rolls over when the stored period differs from the current month.
   * A request over quota is rejected without being counted.
   */
  private async consumeQuota(req: Record<string, any>, res: Record<string, any>, apiKey: ApiKeyLimits) {
    if (req[REQ_QUOTA_COUNTED]) return; // several throttlers / guards on one route
    req[REQ_QUOTA_COUNTED] = true;

    const now = new Date();
    const period = quotaPeriod(now);
    const rows = await this.prisma.$queryRaw<{ quotaUsed: number; monthlyQuota: number | null }[]>`
      UPDATE "api_keys"
         SET "quotaUsed"   = CASE WHEN "quotaPeriod" = ${period} THEN "quotaUsed" + 1 ELSE 1 END,
             "quotaPeriod" = ${period}
       WHERE "id" = ${apiKey.id}
         AND ("monthlyQuota" IS NULL
              OR "quotaPeriod" IS DISTINCT FROM ${period}
              OR "quotaUsed" < "monthlyQuota")
      RETURNING "quotaUsed", "monthlyQuota"`;

    const resetSeconds = secondsUntilNextMonth(now);
    if (rows.length === 0) {
      this.setQuotaHeaders(res, {
        limit: apiKey.monthlyQuota,
        used: apiKey.monthlyQuota ?? 0,
        remaining: 0,
        resetSeconds,
      });
      res.header?.('Retry-After', String(resetSeconds));
      throw new ThrottlerException('Monthly API quota exceeded for this API key');
    }

    const { quotaUsed, monthlyQuota } = rows[0];
    this.setQuotaHeaders(res, {
      limit: monthlyQuota,
      used: quotaUsed,
      remaining: monthlyQuota === null ? null : Math.max(0, monthlyQuota - quotaUsed),
      resetSeconds,
    });
  }

  private setQuotaHeaders(res: Record<string, any>, usage: QuotaUsage) {
    if (typeof res?.header !== 'function') return;
    res.header('X-RateLimit-Quota-Used', String(usage.used));
    res.header('X-RateLimit-Quota-Reset', String(usage.resetSeconds));
    if (usage.limit !== null) {
      res.header('X-RateLimit-Quota-Limit', String(usage.limit));
      res.header('X-RateLimit-Quota-Remaining', String(usage.remaining ?? 0));
    }
  }

  private async resolveApiKey(req: Record<string, any>): Promise<ApiKeyLimits | null> {
    if (req[REQ_API_KEY]) return req[REQ_API_KEY];

    const select = { id: true, rateLimit: true, monthlyQuota: true } as const;
    if (req.user?.apiKeyId) {
      return this.prisma.apiKey.findUnique({ where: { id: req.user.apiKeyId }, select });
    }

    const rawKey = req.headers?.['x-api-key'];
    if (typeof rawKey !== 'string' || !rawKey) return null;
    // Same hashing as ApiKeysService.hashKey. Validity (revoked/expired) is enforced by the auth guard.
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    return this.prisma.apiKey.findUnique({ where: { keyHash }, select });
  }

  private async resolveUserLimit(userId: string, defaultLimit: number): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rateLimitOverride: true },
    });
    return user?.rateLimitOverride ?? defaultLimit;
  }
}
