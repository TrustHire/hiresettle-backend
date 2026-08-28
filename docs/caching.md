# Caching

## Overview

HireSettle uses a **cache-aside** layer implemented by `CacheService` (`src/common/cache/cache.service.ts`) to reduce latency on expensive or frequently accessed operations. The module is registered globally via `AppCacheModule` (`src/common/cache/cache.module.ts`) so it is available throughout the application without per-module imports.

### Backend Selection

| Backend       | Condition                                             | Persistence                         |
| ------------- | ----------------------------------------------------- | ----------------------------------- |
| **Redis**     | `REDIS_URL` environment variable is set and reachable | Yes (network)                       |
| **In-Memory** | `REDIS_URL` is absent or connection fails             | No (process-local, lost on restart) |

When `REDIS_URL` is set, `CacheService` connects to Redis via `ioredis` during `onModuleInit`. If the Redis connection fails, it gracefully falls back to the in-memory `Map` store and logs a warning.

> **Production note:** Deployment should configure Redis for:
>
> - Shared cache across multiple backend instances
> - Cache persistence across restarts
> - Higher throughput and TTL accuracy

---

## CacheService API

All methods are `async` and accept/return generic types.

### get

```typescript
get<T = unknown>(key: string): Promise<T | null>
```

Retrieves a cached value. Returns `null` if the key does not exist or has expired (for the in-memory store; Redis handles TTL expiry natively).

### set

```typescript
set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void>
```

Stores a value with a TTL in seconds. After `ttlSeconds` the entry is automatically evicted.

### del

```typescript
del(key: string): Promise<void>
```

Deletes a single cache key immediately. Used when a downstream mutation invalidates a cached result.

### flush

```typescript
flush(): Promise<void>
```

Deletes **all** keys from the cache. In Redis this runs `FLUSHDB`; in-memory it clears the `Map`.

---

## Current Usage Sites

All files in `src/` that consume `CacheService`:

### 1. `src/common/stellar/stellar.service.ts`

| Aspect         | Detail                                                                |
| -------------- | --------------------------------------------------------------------- |
| **Purpose**    | Cache Stellar fee estimates to avoid redundant RPC calls              |
| **Cache Key**  | `stellar:fee_estimate`                                                |
| **Value**      | `{ baseFee: number; sorobanFee: number }`                             |
| **TTL**        | **10 seconds**                                                        |
| **Invocation** | `getFeeEstimate()` — checks cache first; on miss, computes and caches |

```typescript
const CACHE_KEY = "stellar:fee_estimate";
const cached = await this.cache.get<{ baseFee: number; sorobanFee: number }>(
  CACHE_KEY,
);
if (cached) return cached;
// ... compute fee ...
await this.cache.set(CACHE_KEY, result, 10);
```

### 2. `src/modules/admin/admin-users.service.ts`

| Aspect           | Detail                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**      | Cache aggregated admin dashboard metrics (engagements by status, milestone volume, dispute counts, user distribution, arbiter workload) |
| **Cache Key**    | `admin:metrics`                                                                                                                         |
| **Value**        | `object` — rich nested metrics object                                                                                                   |
| **TTL**          | **60 seconds**                                                                                                                          |
| **Invocation**   | `getAdminMetrics()` — returns cached metrics or recomputes via multiple parallel Prisma queries                                         |
| **Invalidation** | `invalidateMetricsCache()` calls `this.cache.del('admin:metrics')`                                                                      |

```typescript
private static readonly METRICS_CACHE_KEY = 'admin:metrics';
private static readonly METRICS_TTL_S = 60;

async getAdminMetrics() {
  const cached = await this.cache.get<object>(AdminUsersService.METRICS_CACHE_KEY);
  if (cached) return cached;
  // ... run 8 parallel Prisma queries ...
  await this.cache.set(AdminUsersService.METRICS_CACHE_KEY, result, AdminUsersService.METRICS_TTL_S);
  return result;
}

async invalidateMetricsCache(): Promise<void> {
  await this.cache.del(AdminUsersService.METRICS_CACHE_KEY);
}
```

### 3. `src/modules/admin/admin.controller.ts`

| Aspect       | Detail                                                         |
| ------------ | -------------------------------------------------------------- |
| **Purpose**  | Admin endpoint to flush the entire cache                       |
| **Endpoint** | `POST /admin/cache/flush` (admin-only, JWT + RolesGuard)       |
| **Method**   | `cacheService.flush()`                                         |
| **Use case** | Manual cache reset during debugging or after bulk data changes |

```typescript
@Post('cache/flush')
@HttpCode(HttpStatus.OK)
async flushCache() {
  await this.cacheService.flush();
  return { message: 'Cache flushed successfully' };
}
```

### 4. `src/modules/users/users.service.ts`

| Aspect         | Detail                                                                            |
| -------------- | --------------------------------------------------------------------------------- |
| **Purpose**    | Cache public user profile lookups by Stellar address                              |
| **Cache Key**  | `user:profile:${stellarAddress}`                                                  |
| **Value**      | `{ name, company, role }`                                                         |
| **TTL**        | **60 seconds**                                                                    |
| **Invocation** | `findByStellarAddress()` — checks cache first; on miss, queries Prisma and caches |

```typescript
private static readonly PROFILE_TTL_S = 60;

async findByStellarAddress(stellarAddress: string): Promise<PublicUserDto> {
  const cacheKey = `user:profile:${stellarAddress}`;
  const cached = await this.cache?.get<PublicUserDto>(cacheKey);
  if (cached) return cached;

  const user = await this.prisma.user.findUnique({ where: { stellarAddress }, ... });
  if (!user) throw new NotFoundException('User not found');

  await this.cache?.set(cacheKey, user, UsersService.PROFILE_TTL_S);
  return user;
}
```

---

## Cache Invalidation Strategies

### Cached keys per module

The table below lists every key pattern that is currently written to the cache,
which module owns it, the default TTL, and what triggers explicit invalidation.

| Cache key pattern | Module | Default TTL | Invalidation trigger |
|---|---|---|---|
| `stellar:fee_estimate` | `StellarService` (`common/stellar`) | **10 s** | TTL expiry only — no explicit `del()` call; fee data is short-lived by design |
| `admin:metrics` | `AdminUsersService` (`modules/admin`) | **60 s** | Explicit `cache.del('admin:metrics')` via `invalidateMetricsCache()`, called after any admin action that mutates engagement, milestone, dispute, or user data |
| `user:profile:<stellarAddress>` | `UsersService` (`modules/users`) | **60 s** | TTL expiry only — profile data (name, company, role, verifiedAt) changes infrequently; a 60-second window is acceptable |

> **TTL default:** 10–60 seconds, chosen to absorb burst reads without serving
> data that is meaningfully stale. No key is cached without a finite TTL.

### Explicit deletion by key

Use `cache.del(key)` when a specific cached entity is mutated downstream. Currently implemented in `AdminUsersService.invalidateMetricsCache()` — intended to be called whenever an admin action changes metrics data.

### Full flush

Use `cache.flush()` for bulk invalidation. Currently exposed via `POST /admin/cache/flush` for administrative use. In Redis this runs `FLUSHDB` which clears **all** databases in the selected index.

### TTL-based expiry

All cache entries carry a TTL. The application relies on TTL expiry as the primary eviction mechanism. Typical TTLs are **10–60 seconds** — short enough to avoid serving stale data but long enough to absorb repeated requests.

### Future improvements

- **Event-driven invalidation:** Subscribe to `chain_event` creation to proactively bust related cache keys (e.g., delete `stellar:fee_estimate` on ledger change).
- **Tag-based invalidation:** Group cache keys by entity type so a single mutation can expire all related keys.

---

## Best Practices

1. **Always set a TTL** — never cache without an expiration. Even "static" data should have a generous but finite TTL.
2. **Use descriptive, prefixed keys** — follow the existing conventions:
   - `stellar:*` for Stellar-related data
   - `admin:*` for admin dashboard data
   - `user:*` for user-related data
3. **Handle cache-aside misses gracefully** — expect `null` from `get()` and always have a fallback data source.
4. **Don't cache per-user data without a key scope** — use `user:profile:${identifier}` patterns to avoid collisions.
5. **Avoid caching in write-hot paths** — caching is for read-heavy, compute-heavy, or high-latency operations.
6. **Optional chaining on non-global modules** — if a service is not guaranteed to be in a global module, use `this.cache?.get()` optional call pattern.

---

## Configuration

| Variable    | Required | Default | Description                                                                        |
| ----------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `REDIS_URL` | No       | —       | Redis connection URL (e.g. `redis://localhost:6379`). Omit to use in-memory store. |

---

## Testing

`CacheService` is fully mockable in unit tests. Existing test files (e.g. `src/modules/users/users.service.spec.ts`) demonstrate the standard mock pattern:

```typescript
const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};
```

Integration tests in `src/integration/` cover the cache-aside behavior end-to-end when Redis is configured.
