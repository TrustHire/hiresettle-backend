import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';

const CURSOR_KEY = 'horizon_last_ledger';
const MAX_BACKOFF_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2_000;

@Injectable()
export class HorizonIndexerService {
  private readonly logger = new Logger(HorizonIndexerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async indexEvents(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Horizon indexer already running — skipping tick');
      return;
    }
    this.isRunning = true;
    try {
      await this.runWithBackoff();
    } finally {
      this.isRunning = false;
    }
  }

  private async runWithBackoff(attempt = 0): Promise<void> {
    try {
      const fromLedger = await this.readCursor();
      const events = await this.stellar.fetchContractEvents(fromLedger);
      if (!events.length) return;

      let maxLedger = fromLedger;
      for (const event of events) {
        await this.persistEvent(event);
        maxLedger = Math.max(maxLedger, event.ledger + 1);
      }

      await this.writeCursor(maxLedger);
      this.logger.log(`Indexed ${events.length} event(s); cursor advanced to ledger ${maxLedger}`);
    } catch (error) {
      if (this.isRateLimitError(error) && attempt < MAX_BACKOFF_ATTEMPTS) {
        const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        this.logger.warn(`Horizon rate limit hit (attempt ${attempt + 1}) — backing off ${waitMs}ms`);
        await this.sleep(waitMs);
        return this.runWithBackoff(attempt + 1);
      }
      this.logger.error('Horizon indexing failed', error?.message ?? error);
    }
  }

  private async readCursor(): Promise<number> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CURSOR_KEY } });
    if (row) return Number(row.value);

    // First run: start 10 ledgers behind the current tip
    const latest = await this.stellar.getLatestLedger();
    const start = Math.max(1, latest - 10);
    await this.writeCursor(start);
    this.logger.log(`Horizon indexer initialised at ledger ${start}`);
    return start;
  }

  private async writeCursor(ledger: number): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: String(ledger) },
      update: { value: String(ledger) },
    });
  }

  private async persistEvent(event: any): Promise<void> {
    const txHash = event.txHash ?? '';
    const eventName = this.extractEventName(event);
    const payload = event.value ? JSON.parse(JSON.stringify(event.value)) : {};

    // Idempotency: skip if already stored
    const exists = await this.prisma.chainEvent.findFirst({ where: { txHash, eventName } });
    if (exists) return;

    const engagementId = this.extractEngagementId(payload);

    await this.prisma.chainEvent.create({
      data: {
        eventName,
        ledger: event.ledger ?? 0,
        txHash,
        payload,
        processed: false,
        engagementId: engagementId ?? undefined,
      },
    });
  }

  private extractEventName(event: any): string {
    try {
      const topics: any[] = event.topic ?? [];
      return topics[0]?.toString() ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private extractEngagementId(payload: any): string | null {
    if (Array.isArray(payload)) return typeof payload[0] === 'string' ? payload[0] : null;
    return typeof payload === 'string' ? payload : null;
  }

  private isRateLimitError(error: any): boolean {
    return (
      error?.status === 429 ||
      error?.response?.status === 429 ||
      String(error?.message ?? '').includes('429') ||
      String(error?.message ?? '').toLowerCase().includes('rate limit')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
