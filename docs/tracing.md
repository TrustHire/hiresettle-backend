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

## Troubleshooting

If spans never show up in your collector or UI, work through these checks in order.

1. **Confirm `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the process that runs the API.**
   When this variable is unset, `src/tracing.ts` skips SDK startup entirely, so no spans
   are emitted. Restart the server after changing env vars (Nest watch reloads code but
   does not always re-read shell exports).

2. **Ensure `src/tracing.ts` is loaded before any other application code.**
   OpenTelemetry must patch `http`, Express, and Prisma before those modules load. The
   entrypoint must keep `import './tracing';` as the first line of `src/main.ts`. If you
   add a custom bootstrap, alternate entry file, or tests that import app modules directly,
   import `./tracing` (or `./dist/tracing` in compiled runs) first there too.

3. **Verify the OTLP endpoint URL and protocol.**
   The exporter sends traces to `<OTEL_EXPORTER_OTLP_ENDPOINT>/v1/traces` over **HTTP**
   (not gRPC). Use the collector’s OTLP **HTTP** listener (Jaeger’s default is port
   `4318`). Set the base URL only—for example `http://localhost:4318`, not
   `.../v1/traces`. From inside Docker, `localhost` is the container itself; use the
   collector’s service hostname or `host.docker.internal` when the collector runs on the
   host.

4. **Check that the collector is running and reachable.**
   From the same network namespace as the API, confirm the traces endpoint responds (for
   example `curl -v -X POST "$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces"` should connect;
   an empty or invalid body may return 4xx, which still proves reachability). Fix firewall
   rules, TLS mismatches (`http` vs `https`), and missing auth headers required by your
   backend (`OTEL_EXPORTER_OTLP_HEADERS`).

5. **Generate traffic after startup.**
   Spans appear only when instrumented code runs (HTTP requests, Prisma queries, etc.).
   Hit a health or API route, then search in your backend using the configured
   `OTEL_SERVICE_NAME` (default `hiresettle-backend`).
