import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * HorizonFailoverService
 *
 * Manages a prioritised list of Horizon endpoints and transparently fails over
 * to the next healthy one when the active endpoint accumulates N consecutive
 * errors.
 *
 * Configuration (all optional — sensible defaults apply):
 *   HORIZON_URLS                  comma-separated list of URLs (first is primary)
 *   STELLAR_HORIZON_URL           single-URL fallback (existing env var, kept for compat)
 *   HORIZON_FAILOVER_THRESHOLD    consecutive errors before failover (default 3)
 *   HORIZON_RECOVERY_INTERVAL_MS  ms between recovery probes on failed endpoints (default 60000)
 *
 * The service never blocks callers during a probe — probes run in the
 * background so that a recovering endpoint is promoted silently.
 */
@Injectable()
export class HorizonFailoverService implements OnModuleInit {
  private readonly logger = new Logger(HorizonFailoverService.name);

  private urls: string[] = [];
  private activeIndex = 0;
  private readonly consecutiveErrors: number[] = [];
  private threshold = 3;
  private recoveryIntervalMs = 60_000;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Parse URL list — HORIZON_URLS takes priority, falls back to STELLAR_HORIZON_URL
    const multiUrl = this.config.get<string>('HORIZON_URLS', '');
    const singleUrl = this.config.get<string>('STELLAR_HORIZON_URL', '');
    const stellarConfig = this.config.get<any>('stellar') ?? {};

    const raw = multiUrl || singleUrl || stellarConfig.horizonUrl || '';
    this.urls = raw
      .split(',')
      .map((u: string) => u.trim())
      .filter(Boolean);

    if (this.urls.length === 0) {
      throw new Error(
        'No Horizon URLs configured. Set HORIZON_URLS or STELLAR_HORIZON_URL.',
      );
    }

    this.threshold = this.config.get<number>('HORIZON_FAILOVER_THRESHOLD', 3);
    this.recoveryIntervalMs = this.config.get<number>(
      'HORIZON_RECOVERY_INTERVAL_MS',
      60_000,
    );

    // Initialise per-endpoint error counters
    for (let i = 0; i < this.urls.length; i++) {
      this.consecutiveErrors[i] = 0;
    }

    this.logger.log(
      `Horizon failover initialised with ${this.urls.length} endpoint(s). ` +
        `Active: ${this.activeUrl} | threshold: ${this.threshold} | ` +
        `recovery probe: ${this.recoveryIntervalMs}ms`,
    );

    // Only start the recovery timer when we have more than one endpoint
    if (this.urls.length > 1) {
      this.startRecoveryProbe();
    }
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /** The currently active Horizon base URL. */
  get activeUrl(): string {
    return this.urls[this.activeIndex];
  }

  /** All configured URLs with their health state — used in /health. */
  get endpointStatus(): Array<{ url: string; active: boolean; consecutiveErrors: number }> {
    return this.urls.map((url, i) => ({
      url,
      active: i === this.activeIndex,
      consecutiveErrors: this.consecutiveErrors[i] ?? 0,
    }));
  }

  /**
   * Perform a `fetch` against the active Horizon endpoint, transparently
   * retrying on the next endpoint if the active one fails.
   *
   * `path` should start with `/` (e.g. `/accounts/GABCD…`).
   */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    // Try the active endpoint first, then walk the list once
    for (let attempt = 0; attempt < this.urls.length; attempt++) {
      const url = `${this.activeUrl}${path}`;
      try {
        const response = await globalThis.fetch(url, init);
        this.recordSuccess(this.activeIndex);
        return response;
      } catch (err) {
        this.logger.warn(
          `Horizon fetch failed on ${this.activeUrl}${path}: ${err.message}`,
        );
        this.recordError(this.activeIndex);
        // If we just failed over, the activeIndex has changed — next loop
        // iteration will use the new active endpoint automatically.
      }
    }

    throw new Error(
      `All ${this.urls.length} Horizon endpoint(s) failed for path: ${path}`,
    );
  }

  // ----------------------------------------------------------
  // ERROR / SUCCESS TRACKING
  // ----------------------------------------------------------

  private recordSuccess(index: number) {
    this.consecutiveErrors[index] = 0;
  }

  private recordError(index: number) {
    this.consecutiveErrors[index] = (this.consecutiveErrors[index] ?? 0) + 1;

    if (
      this.urls.length > 1 &&
      this.consecutiveErrors[index] >= this.threshold &&
      index === this.activeIndex
    ) {
      this.failover();
    }
  }

  private failover() {
    const failed = this.urls[this.activeIndex];
    const next = (this.activeIndex + 1) % this.urls.length;

    // Safety: don't loop back to the same broken endpoint
    if (next === this.activeIndex) {
      this.logger.error(
        `Failover triggered but no alternate endpoint available — staying on ${failed}`,
      );
      return;
    }

    this.activeIndex = next;
    this.logger.warn(
      `Horizon failover: switching from ${failed} to ${this.activeUrl}`,
    );
  }

  // ----------------------------------------------------------
  // RECOVERY PROBE
  // ----------------------------------------------------------

  private startRecoveryProbe() {
    this.recoveryTimer = setInterval(
      () => this.probeFailedEndpoints(),
      this.recoveryIntervalMs,
    );
  }

  /**
   * Probe any endpoint that isn't currently active and has errors.
   * If the probe succeeds, move that endpoint back to the front as primary.
   */
  private async probeFailedEndpoints() {
    for (let i = 0; i < this.urls.length; i++) {
      if (i === this.activeIndex) continue;
      if ((this.consecutiveErrors[i] ?? 0) === 0) continue;

      try {
        const probeUrl = `${this.urls[i]}/`;
        const res = await globalThis.fetch(probeUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok || res.status < 500) {
          this.logger.log(
            `Horizon recovery probe succeeded for ${this.urls[i]} — restoring as active`,
          );
          this.consecutiveErrors[i] = 0;
          // Promote recovered endpoint to active only if it was the original primary (index 0)
          if (i === 0) {
            this.activeIndex = 0;
            this.logger.log(`Horizon primary endpoint restored: ${this.urls[0]}`);
          }
        }
      } catch {
        // Still down — stay failed
      }
    }
  }

  onModuleDestroy() {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }
  }
}
