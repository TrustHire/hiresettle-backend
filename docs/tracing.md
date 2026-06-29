# Distributed Tracing (OpenTelemetry)

HireSettle backend is instrumented with [OpenTelemetry](https://opentelemetry.io/)
for end-to-end request tracing.

## Enabling tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the base URL of an OTLP-compatible
collector (traces are POSTed to `<endpoint>/v1/traces`). If unset, tracing is
disabled entirely and there is no instrumentation overhead.

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=hiresettle-backend
```

Tracing bootstrap lives in `src/tracing.ts` and is imported as the very first
line of `src/main.ts`, before any other module, so that instrumented modules
(`http`, Prisma) are patched before they are required.

## What's instrumented

- `@opentelemetry/auto-instrumentations-node` — auto-instruments inbound/outbound
  HTTP (covers the NestJS HTTP server and Express, plus any outbound `axios`/`http` calls).
- `@prisma/instrumentation` — instruments Prisma Client queries.
- `TracingInterceptor` (`src/common/interceptors/tracing.interceptor.ts`) — a
  global NestJS interceptor that adds `request.id`, `user.id`, and
  `engagement.id` as span attributes on every request, when available.

## Compatible backends

Any OTLP/HTTP-compatible collector works, including:

- [Jaeger](https://www.jaegertracing.io/) (`collector` OTLP HTTP receiver, default port `4318`)
- [Grafana Tempo](https://grafana.com/oss/tempo/)
- [Honeycomb](https://www.honeycomb.io/) (via their OTLP endpoint + API key header)

For backends that require auth headers (e.g. Honeycomb), set them via the
[`OTEL_EXPORTER_OTLP_HEADERS`](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
standard env var, which `OTLPTraceExporter` reads automatically.
