import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HorizonFailoverService } from '../../common/stellar/horizon-failover.service';
import { MetricsService } from '../../metrics/metrics.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';

/** Horizon payment record (simplified — only what we need) */
interface HorizonPayment {
  id: string;
  type: string;
  transaction_hash: string;
  transaction: {
    memo?: string;
    memo_type?: string;
    ledger_attr?: number;
  };
  from: string;
  to: string;
  asset_type: string;     // 'native' | 'credit_alphanum4' | 'credit_alphanum12'
  asset_code?: string;
  asset_issuer?: string;
  amount: string;
  ledger_attr?: number;   // some Horizon versions surface this on the payment record directly
  paging_token: string;
}

/** SystemConfig key for persisting the Horizon payments cursor */
const CURSOR_KEY = 'horizon_payments_cursor';

/** Alert threshold — notify admins when pending unmatched payments exceed this */
const DEFAULT_ALERT_THRESHOLD = 5;

/**
 * IncomingPaymentPollerService
 *
 * Polls Horizon's /payments endpoint for the HireSettle escrow contract address
 * every 30 seconds. For each incoming payment_to the contract:
 *  1. Check whether the memo matches an active engagement ID.
 *  2. If matched  → silently skip (already handled via contract events).
 *  3. If unmatched → persist to UnmatchedPayment table for admin review.
 *  4. After each run, update the Prometheus gauge and alert admins when
 *     pending count exceeds the configured threshold.
 *
 * The Horizon paging cursor is persisted in SystemConfig so the poller
 * resumes after a restart without reprocessing historical payments.
 */
@Injectable()
export class IncomingPaymentPollerService implements OnModuleInit {
  private readonly logger = new Logger(IncomingPaymentPollerService.name);
  private contractAddress: string | null = null;
  private lastAlertedCount = 0;
  private readonly alertThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly horizon: HorizonFailoverService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly notifications: NotificationsService,
  ) {
    this.alertThreshold = this.config.get<number>(
      'UNMATCHED_PAYMENT_ALERT_THRESHOLD',
      DEFAULT_ALERT_THRESHOLD,
    );
  }

  async onModuleInit() {
    // Resolve the contract address from stellar config
    const stellarConfig = this.config.get<any>('stellar') ?? {};
    this.contractAddress = stellarConfig.contractAddress ?? null;
    if (!this.contractAddress) {
      this.logger.warn(
        'No SOROBAN_CONTRACT_ADDRESS configured — incoming payment polling disabled',
      );
    } else {
      this.logger.log(
        `Incoming payment poller watching: ${this.contractAddress}`,
      );
    }

    // Sync pending count gauge on startup
    await this.syncPendingGauge();
  }

  // ----------------------------------------------------------
  // CRON: every 30 seconds
  // ----------------------------------------------------------

  @Cron('*/30 * * * * *', { name: 'incoming-payment-poller' })
  async pollIncomingPayments(): Promise<void> {
    if (!this.contractAddress) return;

    try {
      await this.poll();
    } catch (err) {
      this.logger.error('Incoming payment poll failed', err?.message);
    }
  }

  // ----------------------------------------------------------
  // CORE POLL LOGIC
  // ----------------------------------------------------------

  async poll(): Promise<{ checked: number; unmatched: number }> {
    if (!this.contractAddress) return { checked: 0, unmatched: 0 };

    const cursor = await this.loadCursor();
    const payments = await this.fetchPayments(cursor);

    if (!payments.length) return { checked: 0, unmatched: 0 };

    this.logger.debug(`Fetched ${payments.length} payment(s) from Horizon`);

    let unmatchedCount = 0;
    let lastPagingToken = cursor;

    for (const payment of payments) {
      lastPagingToken = payment.paging_token;

      // Only process incoming payments to our contract address
      if (payment.to !== this.contractAddress) continue;
      // Only handle actual payment operations
      if (!['payment', 'create_account'].includes(payment.type)) continue;

      const memo = payment.transaction?.memo ?? null;
      const memoType = payment.transaction?.memo_type ?? null;

      const matched = await this.matchMemoToEngagement(memo);
      if (matched) {
        this.logger.debug(
          `Payment ${payment.transaction_hash} memo "${memo}" → engagement ${matched}`,
        );
        continue;
      }

      // Store as unmatched (idempotent on txHash)
      const existing = await this.prisma.unmatchedPayment.findUnique({
        where: { txHash: payment.transaction_hash },
      });
      if (existing) continue;

      await this.prisma.unmatchedPayment.create({
        data: {
          txHash: payment.transaction_hash,
          sender: payment.from,
          assetCode: payment.asset_type === 'native' ? 'XLM' : (payment.asset_code ?? 'UNKNOWN'),
          assetIssuer: payment.asset_issuer ?? null,
          amount: payment.amount,
          memo,
          memoType,
          ledger: payment.ledger_attr ?? 0,
          status: 'PENDING',
        },
      });

      this.metrics.unmatchedPaymentsTotal.inc();
      unmatchedCount++;

      this.logger.warn(
        `Unmatched payment stored: txHash=${payment.transaction_hash} ` +
          `from=${payment.from} amount=${payment.amount} memo="${memo}"`,
      );
    }

    // Persist cursor so next poll continues from here
    await this.saveCursor(lastPagingToken);

    // Update Prometheus gauge and fire threshold alert if needed
    await this.syncPendingGauge();
    await this.maybeAlertAdmins();

    return { checked: payments.length, unmatched: unmatchedCount };
  }

  // ----------------------------------------------------------
  // MEMO MATCHING
  // ----------------------------------------------------------

  /**
   * Returns the engagement ID if the memo resolves to an active engagement,
   * otherwise null.
   */
  private async matchMemoToEngagement(memo: string | null): Promise<string | null> {
    if (!memo) return null;

    const engagement = await this.prisma.engagement.findUnique({
      where: { id: memo },
      select: { id: true, status: true },
    });

    // We only consider active/pending statuses as "matched"
    if (
      engagement &&
      ['ACTIVE', 'PENDING_ACCEPTANCE', 'REPLACEMENT_REQUESTED'].includes(engagement.status)
    ) {
      return engagement.id;
    }

    return null;
  }

  // ----------------------------------------------------------
  // HORIZON FETCH
  // ----------------------------------------------------------

  private async fetchPayments(cursor: string): Promise<HorizonPayment[]> {
    const path =
      `/accounts/${encodeURIComponent(this.contractAddress!)}/payments` +
      `?order=asc&limit=50&include_failed=false` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');

    try {
      const res = await this.horizon.fetch(path);
      if (!res.ok) {
        // 404 means the account hasn't been created on-chain yet — not an error
        if (res.status === 404) return [];
        this.logger.warn(`Horizon payments returned HTTP ${res.status}`);
        return [];
      }

      const body = await res.json() as any;
      return (body?._embedded?.records ?? []) as HorizonPayment[];
    } catch (err) {
      this.logger.error('Failed to fetch Horizon payments', err?.message);
      return [];
    }
  }

  // ----------------------------------------------------------
  // CURSOR PERSISTENCE (SystemConfig)
  // ----------------------------------------------------------

  private async loadCursor(): Promise<string> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: CURSOR_KEY },
    });
    return row?.value ?? '';
  }

  private async saveCursor(cursor: string): Promise<void> {
    if (!cursor) return;
    await this.prisma.systemConfig.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: cursor },
      update: { value: cursor },
    });
  }

  // ----------------------------------------------------------
  // PROMETHEUS + ALERT
  // ----------------------------------------------------------

  async syncPendingGauge(): Promise<void> {
    const count = await this.prisma.unmatchedPayment.count({
      where: { status: 'PENDING' },
    });
    this.metrics.unmatchedPaymentsPending.set(count);
  }

  private async maybeAlertAdmins(): Promise<void> {
    const count = await this.prisma.unmatchedPayment.count({
      where: { status: 'PENDING' },
    });

    // Fire alert only when crossing the threshold, not on every poll
    if (count >= this.alertThreshold && this.lastAlertedCount < this.alertThreshold) {
      this.lastAlertedCount = count;
      await this.notifyAdmins(count);
    } else if (count < this.alertThreshold) {
      // Reset so the alert fires again next time threshold is crossed
      this.lastAlertedCount = 0;
    }
  }

  private async notifyAdmins(pendingCount: number): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deactivatedAt: null },
      select: { id: true },
    });

    const message =
      `${pendingCount} incoming Stellar payment(s) could not be matched to an engagement ` +
      `(threshold: ${this.alertThreshold}). Review them at GET /admin/unmatched-payments.`;

    await Promise.allSettled(
      admins.map((admin) =>
        this.notifications.notifyUserById(
          admin.id,
          NotificationType.UNMATCHED_PAYMENT_ALERT,
          'Unmatched Payments Require Review',
          message,
          { pendingCount, threshold: this.alertThreshold },
        ),
      ),
    );
  }
}
