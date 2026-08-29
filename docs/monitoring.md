# Monitoring

The backend exposes a Prometheus-compatible `/metrics` endpoint (see
[`src/metrics`](../src/metrics)) via `prom-client`. This document lists the
metrics that are emitted, their labels, and example Grafana/PromQL queries
for building dashboards.

## Scrape endpoint

```
GET /metrics
```

- Content type: `text/plain; version=0.0.4` (standard Prometheus exposition format).
- Access can be restricted to a set of IPs via the `METRICS_ALLOWED_IPS` env
  var (comma-separated). If unset, the endpoint is open — restrict it at the
  network/ingress level in production. See
  [environment-variables.md](./environment-variables.md).
- Default Node.js process metrics (`process_cpu_seconds_total`,
  `nodejs_heap_size_bytes`, etc.) are included via `collectDefaultMetrics()`.

## Exported metrics

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `http_requests_total` | Counter | `method`, `route`, `status` | Total HTTP requests handled |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | HTTP request duration, buckets `[0.005 .. 5]`s |
| `db_query_duration_seconds` | Histogram | `model`, `action` | Prisma query duration, buckets `[0.001 .. 1]`s |
| `sse_active_connections` | Gauge | — | Number of open notification SSE connections |
| `stellar_circuit_breaker_state` | Gauge | — | Circuit breaker state: `0`=closed, `1`=open, `2`=half-open |
| `stellar_rpc_calls_total` | Counter | `result` | Total Stellar RPC calls by outcome (e.g. `success`, `error`) |
| `stellar_rpc_duration_seconds` | Histogram | `operation` | Stellar RPC call duration, buckets `[0.1 .. 30]`s |

See [`src/metrics/metrics.service.ts`](../src/metrics/metrics.service.ts) for
the authoritative metric definitions, and
[`docs/alerts.md`](./alerts.md) for the alerting rules built on top of these
metrics (plus `dead_letter_queue_depth`, `prisma_pool_connections_*`, and
`notification_delivery_*` metrics, which require additional exporters — see
the notes in that file).

## Example PromQL queries

**Request rate by route**
```promql
sum(rate(http_requests_total[5m])) by (route)
```

**p95 latency by route**
```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```

**Error rate (5xx) by route**
```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) by (route)
/ sum(rate(http_requests_total[5m])) by (route)
```

**Database query p95 by model/action**
```promql
histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket[5m])) by (le, model, action))
```

**Active SSE connections**
```promql
sse_active_connections
```

**Stellar circuit breaker currently open**
```promql
stellar_circuit_breaker_state == 1
```

**Stellar RPC error rate**
```promql
sum(rate(stellar_rpc_calls_total{result="error"}[5m]))
/ sum(rate(stellar_rpc_calls_total[5m]))
```

**Stellar RPC p95 latency by operation**
```promql
histogram_quantile(0.95, sum(rate(stellar_rpc_duration_seconds_bucket[5m])) by (le, operation))
```

## Building a Grafana dashboard

1. Add a Prometheus data source pointed at your scrape target for `/metrics`.
2. Create panels using the queries above — time series panels for
   rate/latency queries, a stat/gauge panel for `stellar_circuit_breaker_state`
   and `sse_active_connections`.
3. Reuse the same expressions as the alert rules in
   [`docs/alerts.md`](./alerts.md) so dashboard panels and alerts stay
   consistent, and link the dashboard from
   [`docs/runbook.md`](./runbook.md) for on-call use.
