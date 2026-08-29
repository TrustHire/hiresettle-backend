import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly dbQueryDuration = new Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query duration in seconds',
    labelNames: ['model', 'action'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [this.registry],
  });

  readonly sseActiveConnections = new Gauge({
    name: 'sse_active_connections',
    help: 'Number of active Server-Sent Events connections',
    registers: [this.registry],
  });

  readonly stellarCircuitBreakerState = new Gauge({
    name: 'stellar_circuit_breaker_state',
    help: 'Stellar RPC circuit breaker state (0=closed, 1=open, 2=half-open)',
    registers: [this.registry],
  });

  readonly stellarRpcCallsTotal = new Counter({
    name: 'stellar_rpc_calls_total',
    help: 'Total Stellar RPC calls by result',
    labelNames: ['result'],
    registers: [this.registry],
  });

  readonly stellarRpcDuration = new Histogram({
    name: 'stellar_rpc_duration_seconds',
    help: 'Stellar RPC call duration in seconds',
    labelNames: ['operation'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    // Initialize circuit breaker state to closed
    this.stellarCircuitBreakerState.set(0);
  }

  recordHttpRequest(method: string, route: string, status: number, durationMs: number) {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationMs / 1000);
  }

  recordDbQuery(model: string, action: string, durationMs: number) {
    this.dbQueryDuration.observe({ model: model ?? 'unknown', action }, durationMs / 1000);
  }

  recordStellarRpc(operation: string, durationMs: number) {
    this.stellarRpcDuration.observe({ operation }, durationMs / 1000);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
