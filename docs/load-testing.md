# Load Testing

The backend has a [k6](https://k6.io/) load/stress test suite under
[`test/load`](../test/load) covering the write-heavy, read-heavy, and
streaming paths. This document explains how to run those scenarios locally
and how to interpret the results against the target SLOs.

## Prerequisites

- [Install k6](https://k6.io/docs/get-started/installation/).
- A running instance of the backend (`npm run start:dev` or a deployed
  environment) reachable at the URL you'll pass as `BASE_URL`.
- A valid JWT for an authenticated user, passed as `AUTH_TOKEN`. See
  [environment-variables.md](./environment-variables.md) and the auth
  endpoints for how to obtain one.

## Scenarios

| Script | Target endpoint | What it measures |
| --- | --- | --- |
| [`test/load/engagement-create.js`](../test/load/engagement-create.js) | `POST /api/v1/engagements` | Write path (engagement creation + Soroban stub) |
| [`test/load/engagement-list.js`](../test/load/engagement-list.js) | `GET /api/v1/engagements` | Read-heavy listing path |
| [`test/load/notification-stream.js`](../test/load/notification-stream.js) | `GET /api/v1/notifications/stream` | SSE connection time-to-first-byte |

Each scenario runs 100 constant virtual users (VUs) for 60 seconds.

## Running a scenario

```bash
BASE_URL=http://localhost:3000 AUTH_TOKEN=<jwt> k6 run test/load/engagement-create.js
BASE_URL=http://localhost:3000 AUTH_TOKEN=<jwt> k6 run test/load/engagement-list.js
BASE_URL=http://localhost:3000 AUTH_TOKEN=<jwt> k6 run test/load/notification-stream.js
```

`BASE_URL` defaults to `http://localhost:3000` if not set. `AUTH_TOKEN`
defaults to an empty string, which will cause every request to be rejected
with `401` — always set it for a meaningful run.

To run all three scenarios back to back:

```bash
for f in test/load/*.js; do
  BASE_URL=http://localhost:3000 AUTH_TOKEN=<jwt> k6 run "$f"
done
```

## Thresholds (pass/fail criteria)

Each script defines k6 `thresholds` that k6 evaluates automatically and
uses to set its own exit code (non-zero if any threshold fails) — this is
what you'd wire into CI to gate on performance regressions.

| Script | Threshold | Meaning |
| --- | --- | --- |
| `engagement-create.js` | `engagement_create_p95: p(95)<200` | 95% of engagement-create requests must complete in under 200ms |
| | `engagement_create_errors: rate<0.01` | Fewer than 1% of requests may fail the `check()` (non-201 or >500ms) |
| `engagement-list.js` | `engagement_list_p95: p(95)<200` | 95% of list requests must complete in under 200ms |
| | `engagement_list_errors: rate<0.01` | Fewer than 1% of requests may fail the `check()` (non-200 or >500ms) |
| `notification-stream.js` | `sse_ttfb_p95: p(95)<200` | 95% of SSE connections must receive their first byte in under 200ms |
| | `sse_errors: rate<0.01` | Fewer than 1% of connections may fail the `check()` (bad status or slow TTFB) |

These targets (p95 < 200ms, <1% error rate) are the backend's baseline SLO
for these paths. If you need to test against a different SLO, override the
threshold with `k6 run --threshold <name>=<expr> ...` rather than editing
the script for a one-off run.

## Reading the output summary

At the end of a run, k6 prints a summary like:

```
     ✓ status is 201
     ✓ response time < 500ms

     checks.........................: 100.00% ✓ 6000      ✗ 0
     data_received..................: 1.2 MB  20 kB/s
     data_sent.......................: 900 kB  15 kB/s
     engagement_create_errors.......: 0.00%   ✓ 0         ✗ 6000
     engagement_create_p95..........: avg=85ms min=40ms med=80ms max=210ms p(90)=110ms p(95)=145ms
     http_req_duration...............: avg=85ms min=40ms med=80ms max=210ms p(90)=110ms p(95)=145ms
     iterations......................: 6000
     vus.............................: 100
```

What to look at:

- **`✓`/`✗` next to `checks`** — the pass rate of the `check()` assertions
  in the script (status code and response time). A drop below 100% means
  some requests failed the check, which feeds into the `*_errors` rate.
- **`<metric>_p95` / `p(95)=`** — the 95th percentile value for the custom
  Trend metric. Compare this against the threshold in the table above.
- **THRESHOLDS section** — k6 prints a `thresholds` block showing each
  threshold and whether it passed. A failed threshold marks the whole run
  as failed (non-zero exit code), even if most checks passed.
- **`iterations` vs `vus`** — sanity check that the expected number of
  iterations ran for the configured VUs/duration; a much lower number than
  expected usually means requests were timing out or blocking.

A run "passes" when every line in the thresholds block shows as satisfied.
If a threshold fails, check backend logs and
[`docs/monitoring.md`](./monitoring.md) / [`docs/runbook.md`](./runbook.md)
for the same time window to correlate with server-side metrics (DB query
duration, Stellar RPC latency, etc.) before concluding it's a backend
regression versus a test-environment issue (e.g. running against a
under-provisioned local database).
