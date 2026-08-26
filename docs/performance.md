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

## Adding a Scenario

Add one JavaScript file under `test/load/`. Use a lowercase kebab-case name in the
form `<resource>-<operation>.js` (for example, `engagement-list.js` or
`notification-stream.js`). Keep the scenario key, custom metric prefixes, and the
name used in the command/CI registration aligned with the filename. A scenario
should represent one endpoint or user flow and should not create or permanently
modify shared test data unless that is the behavior being measured.

Every scenario must:

- use a `constant-vus` executor with **100 VUs for 60 seconds**, unless the test
  has a documented reason to use a different workload;
- record a scenario-specific latency `Trend` and error `Rate`; and
- define both required thresholds: latency `p(95)<200` and error `rate<0.01`.

Minimal skeleton:

```js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const latency = new Trend('widget_list_latency');
const errors = new Rate('widget_list_errors');

export const options = {
  scenarios: {
    widget_list: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
    },
  },
  thresholds: {
    widget_list_latency: ['p(95)<200'],
    widget_list_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.AUTH_TOKEN || '';

export default function () {
  const response = http.get(`${BASE_URL}/api/v1/widgets`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const ok = check(response, { 'status is 200': (r) => r.status === 200 });

  latency.add(response.timings.duration);
  errors.add(!ok);
  sleep(0.5);
}
```

After adding the file, register it in each place contributors use to run load
tests:

1. Add an npm alias to `package.json` (there is no k6 npm dependency):
   `"load:widget-list": "k6 run test/load/widget-list.js"`.
2. Add `k6 run test/load/widget-list.js` to the load-test command or matrix in
   the CI workflow (and provide the same `BASE_URL` and `AUTH_TOKEN` inputs as
   the existing scenarios). If CI does not yet run load tests, add the command
   to the CI load-test job rather than silently relying on the local command.
3. Add the script, endpoint/pattern, and an initial baseline row to the tables
   above, then run the command locally before opening the pull request.

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
