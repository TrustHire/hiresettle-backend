# Rate Limiting

HireSettle uses [@nestjs/throttler](https://github.com/nestjs/throttler) v5 to protect API endpoints. The default
configuration is set in `src/app.module.ts` via `ThrottlerModule.forRootAsync()`.

## Default Limits

| Property | Default | Env Variable     |
|----------|---------|------------------|
| TTL      | 60 s    | `THROTTLE_TTL`   |
| Limit    | 100 req | `THROTTLE_LIMIT` |

Unauthenticated requests fall back to the default limit. Authenticated users
can have a higher limit stored in `User.rateLimitOverride` (see
`src/common/guards/user-jwt-sub-throttler.guard.ts`).

## How Tracking Works

The custom guard `UserJwtSubThrottlerGuard` (`src/common/guards/user-jwt-sub-throttler.guard.ts`)
overrides the default IP-based tracking:

- **Authenticated requests** — tracked by `sub:{user.id}` using the JWT subject.
- **Anonymous requests** — tracked as `'anonymous'`.

The guard also checks `User.rateLimitOverride` at runtime and uses it in place
of the default limit when set.

## Per-Route Override

Use the `@RateLimit()` helper from `src/common/decorators/throttle.decorator.ts`
on individual controllers or methods:

```typescript
import { RateLimit } from '../../common/decorators/throttle.decorator';

@Controller('notifications')
@RateLimit(30, 60)   // 30 requests per 60-second window
export class NotificationsController { … }
```

The decorator accepts `(limit, ttlSeconds)` and wraps the library's
`@Throttle()` so all routes in the project use a consistent API.

## Response Headers

When the rate limit is exceeded, `TooManyRequestsHeadersFilter`
(`src/common/filters/too-many-requests-headers.filter.ts`) catches the
`ThrottlerException` and returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Reset: <unix-timestamp>
```

The response body is uniform JSON:

```json
{
  "success": false,
  "statusCode": 429,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/api/v1/engagements",
  "message": "ThrottlerException: Too Many Requests"
}
```

## Excluded Routes

The `/health` endpoint is excluded from throttling via `skipIf` in the module
configuration (`src/app.module.ts`).
