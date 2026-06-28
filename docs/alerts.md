# Prometheus Alerting Rules

This document contains all Prometheus alerting rules for the HireSettle backend.

## Alert Definitions

```yaml
groups:
  - name: hiresettle_backend
    interval: 30s
    rules:
      - alert: HighLatencyP95
        expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High p95 latency for {{ $labels.route }}"
          description: "p95 latency for {{ $labels.route }} is {{ $value }}s (> 0.5s for 5m)"

      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status=~"5.."}[2m])) by (route) / sum(rate(http_requests_total[2m])) by (route) > 0.01
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High error rate for {{ $labels.route }}"
          description: "Error rate for {{ $labels.route }} is {{ $value | humanizePercentage }} (> 1% for 2m)"

      - alert: DeadLetterQueueDepth
        expr: dead_letter_queue_depth > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Dead-letter queue depth is high"
          description: "Dead-letter queue depth is {{ $value }} (> 10)"

      - alert: DatabasePoolExhaustion
        expr: prisma_pool_connections_active / prisma_pool_connections_max > 0.9
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool nearly exhausted"
          description: "Database pool usage is {{ $value | humanizePercentage }} (> 90%)"
```

## Notes

- Assumes standard Prometheus metrics from NestJS (use `@willsoto/nestjs-prometheus` or similar)
- Adjust metric names to match your actual instrumentation
- Dead-letter queue and DB pool metrics need custom exporters
