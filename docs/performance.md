# Performance Testing

## Overview

Load tests are written with [k6](https://k6.io) and live in `test/load/`. The target SLO is **p95 < 200 ms** at **100 concurrent users**.

## Scenarios

| Script | Endpoint | Pattern |
|--------|----------|---------|
| `engagement-list.js` | `GET /api/v1/engagements` | Read-heavy, paginated list |
| `engagement-create.js` | `POST /api/v1/engagements` | Write + Soroban stub |
| `notification-stream.js` | `GET /api/v1/notifications/stream` | SSE — measures TTFB |

## Running Tests

```bash
# Install k6: https://k6.io/docs/get-started/installation/

# Set env vars
export BASE_URL=http://localhost:3000
export AUTH_TOKEN=<your-jwt>

# Run individual scenarios
k6 run test/load/engagement-list.js
k6 run test/load/engagement-create.js
k6 run test/load/notification-stream.js
```

## Thresholds

All scenarios fail if:
- `p(95) >= 200 ms` for the scenario-specific latency metric
- Error rate `>= 1%`

## Baseline Results

> Results are recorded after each significant change. Update this table after each run.

| Date | Scenario | p50 | p95 | p99 | Error rate | Notes |
|------|----------|-----|-----|-----|------------|-------|
| TBD  | engagement-list | — | — | — | — | Initial baseline |
| TBD  | engagement-create | — | — | — | — | Initial baseline |
| TBD  | notification-stream | — | — | — | — | Initial baseline |

## Bottleneck Checklist

- **Database**: ensure indexes on `Engagement.companyId`, `Engagement.recruiterId`, `Engagement.status`
- **N+1 queries**: check Prisma `include` usage — prefer `select` with explicit fields
- **SSE backpressure**: monitor `events.service.ts` polling interval under load
- **Connection pooling**: `DATABASE_URL` should include `?connection_limit=10`
