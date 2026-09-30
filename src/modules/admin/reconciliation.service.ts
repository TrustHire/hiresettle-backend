import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MetricsService } from '../../metrics/metrics.service';
import { EngagementStatus, NotificationType } from '@prisma/client';

export interface ReconciliationMismatch {
  engagementId: string;
  dbEscrowBalance: string;
  onChainEscrowBalance: string;
  dbReleasedAmount: string;
  onChainReleasedAmount: string;
  dbStatus: string;
  onChainStatus: string;
  kind: 'BALANCE_DRIFT' | 'STATUS_DRIFT' | 'NOT_FOUND_ON_CHAIN';
  detectedAt: string;
}

export interface ReconciliationReport {
  runAt: string;
  totalChecked: number;
  totalMatched: number;
  totalMismatched: number;
  mismatches: ReconciliationMismatch[];
}

/** Statuses that represent live on-chain escrow contracts we need to watch. */
const ACTIVE_STATUSES: EngagementStatus[] = [
  EngagementStatus.ACTIVE,
  EngagementStatus.REPLACEMENT_REQUESTED,
];

/** On-chain status string → DB EngagementStatus mapping */
const ON_CHAIN_STATUS_MAP: Record<string, EngagementStatus> = {
  Active: EngagementStatus.ACTIVE,
  Completed: EngagementStatus.COMPLETED,
  Cancelled: EngagementStatus.CANCELLED,
  ReplacementRequested: EngagementStatus.REPLACEMENT_REQUESTED,
};

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  /** Cache the last completed report so the report endpoint is always fast. */
  private lastReport: ReconciliationReport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    private readonly metrics: MetricsService,
  ) {}

  // ----------------------------------------------------------
  // CRON: nightly at 02:00 UTC
  // ----------------------------------------------------------

  @Cron('0 2 * * *', { name: 'nightly-reconciliation', timeZone: 'UTC' })
  async runNightly() {
    this.logger.log('Starting nightly on-chain/off-chain reconciliation');
    try {
      const report = await this.runReconciliation();
      this.logger.log(
        `Reconciliation complete — checked: ${report.totalChecked}, ` +
          `matched: ${report.totalMatched}, mismatched: ${report.totalMismatched}`,
      );

      if (report.totalMismatched > 0) {
        await this.notifyAdmins(report);
      }
    } catch (err) {
      this.logger.error('Nightly reconciliation failed', err.message);
    }
  }

  // ----------------------------------------------------------
  // CORE RECONCILIATION LOGIC (also callable on-demand)
  // ----------------------------------------------------------

  async runReconciliation(): Promise<ReconciliationReport> {
    const runAt = new Date().toISOString();

    const engagements = await this.prisma.engagement.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        txHash: { not: null }, // only those that have been submitted on-chain
      },
      select: {
        id: true,
        status: true,
        tokenAddress: true,
        totalAmount: true,
        releasedAmount: true,
      },
    });

    const mismatches: ReconciliationMismatch[] = [];
    let totalMatched = 0;

    for (const engagement of engagements) {
      try {
        const mismatch = await this.checkEngagement(engagement);
        if (mismatch) {
          mismatches.push(mismatch);
        } else {
          totalMatched++;
        }
      } catch (err) {
        this.logger.warn(
          `Skipping engagement ${engagement.id} — chain read error: ${err.message}`,
        );
        // Count as a mismatch of kind NOT_FOUND_ON_CHAIN if the contract call fails hard
        mismatches.push({
          engagementId: engagement.id,
          dbEscrowBalance: (engagement.totalAmount - engagement.releasedAmount).toString(),
          onChainEscrowBalance: 'unknown',
          dbReleasedAmount: engagement.releasedAmount.toString(),
          onChainReleasedAmount: 'unknown',
          dbStatus: engagement.status,
          onChainStatus: 'unknown',
          kind: 'NOT_FOUND_ON_CHAIN',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    const report: ReconciliationReport = {
      runAt,
      totalChecked: engagements.length,
      totalMatched,
      totalMismatched: mismatches.length,
      mismatches,
    };

    // Export summary metrics to Prometheus
    this.metrics.reconciliationCheckedTotal.set(engagements.length);
    this.metrics.reconciliationMismatchedTotal.set(mismatches.length);
    this.metrics.reconciliationLastRunTimestamp.setToCurrentTime();

    // Persist the report for the GET endpoint
    this.lastReport = report;

    return report;
  }

  /** Returns the cached report from the last run (or null if never run). */
  getLastReport(): ReconciliationReport | null {
    return this.lastReport;
  }

  // ----------------------------------------------------------
  // PER-ENGAGEMENT CHECK
  // ----------------------------------------------------------

  private async checkEngagement(engagement: {
    id: string;
    status: EngagementStatus;
    tokenAddress: string;
    totalAmount: bigint;
    releasedAmount: bigint;
  }): Promise<ReconciliationMismatch | null> {
    const { nativeToScVal } = await import('@stellar/stellar-sdk');

    const onChain = await this.stellar.simulateContractCall('get_engagement', [
      nativeToScVal(engagement.id, { type: 'string' }),
    ]);

    if (!onChain) {
      return {
        engagementId: engagement.id,
        dbEscrowBalance: (engagement.totalAmount - engagement.releasedAmount).toString(),
        onChainEscrowBalance: '0',
        dbReleasedAmount: engagement.releasedAmount.toString(),
        onChainReleasedAmount: '0',
        dbStatus: engagement.status,
        onChainStatus: 'NotFound',
        kind: 'NOT_FOUND_ON_CHAIN',
        detectedAt: new Date().toISOString(),
      };
    }

    const onChainReleasedAmount = BigInt(onChain.released_amount ?? 0);
    const { balance: onChainEscrowBalance } = await this.stellar.getBalance(
      this.stellar.getContractId(),
      engagement.tokenAddress,
    );

    // DB-side expected escrow = totalAmount − releasedAmount
    const dbEscrowBalance = engagement.totalAmount - engagement.releasedAmount;

    const balanceDrift = onChainEscrowBalance !== dbEscrowBalance;
    const releasedDrift = onChainReleasedAmount !== engagement.releasedAmount;

    const onChainStatusRaw = String(onChain.status ?? 'unknown');
    const onChainStatus = ON_CHAIN_STATUS_MAP[onChainStatusRaw] ?? onChainStatusRaw;
    const statusDrift = onChainStatus !== engagement.status;

    if (!balanceDrift && !releasedDrift && !statusDrift) {
      return null; // clean
    }

    const kind =
      statusDrift && !balanceDrift ? 'STATUS_DRIFT' : 'BALANCE_DRIFT';

    this.logger.warn(
      `Mismatch on engagement ${engagement.id}: ` +
        `dbEscrow=${dbEscrowBalance} onChainEscrow=${onChainEscrowBalance} ` +
        `dbReleased=${engagement.releasedAmount} onChainReleased=${onChainReleasedAmount} ` +
        `dbStatus=${engagement.status} onChainStatus=${onChainStatus}`,
    );

    return {
      engagementId: engagement.id,
      dbEscrowBalance: dbEscrowBalance.toString(),
      onChainEscrowBalance: onChainEscrowBalance.toString(),
      dbReleasedAmount: engagement.releasedAmount.toString(),
      onChainReleasedAmount: onChainReleasedAmount.toString(),
      dbStatus: engagement.status,
      onChainStatus: String(onChainStatus),
      kind,
      detectedAt: new Date().toISOString(),
    };
  }

  // ----------------------------------------------------------
  // ADMIN NOTIFICATION
  // ----------------------------------------------------------

  private async notifyAdmins(report: ReconciliationReport) {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { stellarAddress: true },
    });

    const summary =
      `Nightly reconciliation found ${report.totalMismatched} mismatch(es) ` +
      `out of ${report.totalChecked} active engagements checked. ` +
      `Run GET /admin/reconciliation/report to see details.`;

    await Promise.allSettled(
      admins.map((admin) =>
        admin.stellarAddress
          ? this.notifications.notifyUser(
              admin.stellarAddress,
              NotificationType.FUNDING_SHORTFALL_DETECTED,
              'Reconciliation Drift Detected',
              summary,
              {
                totalChecked: report.totalChecked,
                totalMismatched: report.totalMismatched,
                runAt: report.runAt,
              },
            )
          : Promise.resolve(),
      ),
    );
  }
}
