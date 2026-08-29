import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { MetricsService } from '../../metrics/metrics.service';

export interface CircuitBreakerStats {
  state: 'closed' | 'open' | 'half-open';
  successCount: number;
  failureCount: number;
  rejectCount: number;
  timeoutCount: number;
  fallbackCount: number;
}

/**
 * CircuitBreakerService
 *
 * Wraps outbound Stellar RPC/Horizon calls with a circuit breaker and retry policy.
 * When upstream failures exceed the error threshold, the breaker trips and fails fast
 * instead of waiting for timeouts. After a cooldown period, the breaker allows test
 * requests in half-open state to check if the service recovered.
 *
 * Configuration via env:
 * - STELLAR_BREAKER_TIMEOUT: max call duration before timeout (ms)
 * - STELLAR_BREAKER_ERROR_THRESHOLD: % of failures before tripping (0-100)
 * - STELLAR_BREAKER_RESET_TIMEOUT: cooldown before retry (ms)
 * - STELLAR_BREAKER_ROLLING_COUNT_TIMEOUT: rolling window for error rate (ms)
 *
 * Metrics exposed via Prometheus:
 * - stellar_circuit_breaker_state (gauge): 0=closed, 1=open, 2=half-open
 * - stellar_rpc_calls_total (counter): labeled by result (success, failure, timeout, reject)
 */
@Injectable()
export class CircuitBreakerService implements OnModuleInit {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private breaker: CircuitBreaker;

  // Configurable options
  private readonly timeout: number;
  private readonly errorThresholdPercentage: number;
  private readonly resetTimeout: number;
  private readonly rollingCountTimeout: number;
  private readonly rollingCountBuckets: number;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    // Circuit breaker configuration
    this.timeout = this.config.get<number>('STELLAR_BREAKER_TIMEOUT', 10000); // 10s
    this.errorThresholdPercentage = this.config.get<number>('STELLAR_BREAKER_ERROR_THRESHOLD', 50); // 50%
    this.resetTimeout = this.config.get<number>('STELLAR_BREAKER_RESET_TIMEOUT', 30000); // 30s
    this.rollingCountTimeout = this.config.get<number>('STELLAR_BREAKER_ROLLING_COUNT_TIMEOUT', 10000); // 10s
    this.rollingCountBuckets = this.config.get<number>('STELLAR_BREAKER_ROLLING_COUNT_BUCKETS', 10);
  }

  onModuleInit() {
    // Initialize the circuit breaker with a passthrough function
    // The actual RPC calls are passed at execution time
    this.breaker = new CircuitBreaker(this.executeCall.bind(this), {
      timeout: this.timeout,
      errorThresholdPercentage: this.errorThresholdPercentage,
      resetTimeout: this.resetTimeout,
      rollingCountTimeout: this.rollingCountTimeout,
      rollingCountBuckets: this.rollingCountBuckets,
      name: 'stellar-rpc',
    });

    // Register event listeners for logging and metrics
    this.breaker.on('open', () => {
      this.logger.warn('Circuit breaker OPENED — failing fast for Stellar RPC calls');
      this.metrics.stellarCircuitBreakerState?.set(1);
    });

    this.breaker.on('halfOpen', () => {
      this.logger.log('Circuit breaker HALF-OPEN — testing Stellar RPC recovery');
      this.metrics.stellarCircuitBreakerState?.set(2);
    });

    this.breaker.on('close', () => {
      this.logger.log('Circuit breaker CLOSED — Stellar RPC calls healthy');
      this.metrics.stellarCircuitBreakerState?.set(0);
    });

    this.breaker.on('success', () => {
      this.metrics.stellarRpcCallsTotal?.inc({ result: 'success' });
    });

    this.breaker.on('failure', () => {
      this.metrics.stellarRpcCallsTotal?.inc({ result: 'failure' });
    });

    this.breaker.on('timeout', () => {
      this.logger.warn('Stellar RPC call timed out');
      this.metrics.stellarRpcCallsTotal?.inc({ result: 'timeout' });
    });

    this.breaker.on('reject', () => {
      this.logger.debug('Stellar RPC call rejected (circuit open)');
      this.metrics.stellarRpcCallsTotal?.inc({ result: 'reject' });
    });

    this.breaker.on('fallback', () => {
      this.metrics.stellarRpcCallsTotal?.inc({ result: 'fallback' });
    });

    this.logger.log(
      `Circuit breaker initialized: timeout=${this.timeout}ms, errorThreshold=${this.errorThresholdPercentage}%, resetTimeout=${this.resetTimeout}ms`,
    );
  }

  /**
   * Execute a function wrapped by the circuit breaker.
   * @param fn - async function to execute
   * @param fallback - optional fallback function to call if circuit is open
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    try {
      return await this.breaker.fire(fn) as T;
    } catch (error) {
      // Circuit open and fallback provided
      if (fallback && this.breaker.opened) {
        this.logger.debug('Circuit open — using fallback');
        return await fallback();
      }
      throw error;
    }
  }

  /**
   * Internal passthrough function for opossum.
   * The circuit breaker wraps this, but we pass the actual function at fire() time.
   */
  private async executeCall<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }

  /**
   * Get current circuit breaker statistics.
   */
  getStats(): CircuitBreakerStats {
    const stats = this.breaker.stats;
    return {
      state: this.breaker.opened ? 'open' : this.breaker.halfOpen ? 'half-open' : 'closed',
      successCount: stats.successes,
      failureCount: stats.failures,
      rejectCount: stats.rejects,
      timeoutCount: stats.timeouts,
      fallbackCount: stats.fallbacks,
    };
  }

  /**
   * Check if the circuit breaker is currently open (tripped).
   */
  isOpen(): boolean {
    return this.breaker.opened;
  }

  /**
   * Manually open the circuit breaker (for testing/admin purposes).
   */
  open(): void {
    this.breaker.open();
  }

  /**
   * Manually close the circuit breaker (for testing/admin purposes).
   */
  close(): void {
    this.breaker.close();
  }
}
