import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { User, UserRole } from '@prisma/client';
import { StellarService } from '../../common/stellar/stellar.service';
import { ExchangeRateService } from '../../common/exchange-rates/exchange-rate.service';

/** Round a fiat amount to 2 decimal places. */
function roundFiat(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Escape a value for safe inclusion in a CSV cell. */
function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? '' : String(value);
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly exchangeRates: ExchangeRateService,
  ) {}

  async getBillingSummary(
    companyUser: User,
    fromDate?: Date,
    toDate?: Date,
    fiat?: string,
  ) {
    // Get current calendar month if no dates provided
    const now = new Date();
    const startDate = fromDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = toDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Find engagements where the user is the company
    const engagements = await this.prisma.engagement.findMany({
      where: {
        companyAddress: companyUser.stellarAddress,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        milestones: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate aggregates
    let totalEscrowed = BigInt(0);
    let totalReleased = BigInt(0);
    let totalEscrowedFiat: number | null = null;
    let totalReleasedFiat: number | null = null;
    const fiatCurrency = fiat ? fiat.trim().toUpperCase() : null;

    const engagementBreakdown = await Promise.all(
      engagements.map(async (engagement) => {
        const escrowed = engagement.totalAmount;
        const released = engagement.releasedAmount;

        totalEscrowed += escrowed;
        totalReleased += released;

        // Optional fiat-equivalent totals, converted per token.
        const fiatValues = fiatCurrency
          ? await this.toFiatValues(engagement.tokenAddress, escrowed, released, fiatCurrency)
          : { escrowedFiat: null, releasedFiat: null, tokenSymbol: null };

        if (fiatValues.escrowedFiat != null) {
          totalEscrowedFiat =
            (totalEscrowedFiat ?? 0) + fiatValues.escrowedFiat;
        }
        if (fiatValues.releasedFiat != null) {
          totalReleasedFiat =
            (totalReleasedFiat ?? 0) + fiatValues.releasedFiat;
        }

        return {
          engagementId: engagement.id,
          jobTitle: engagement.jobTitle,
          createdAt: engagement.createdAt,
          totalEscrowed: escrowed.toString(),
          totalReleased: released.toString(),
          status: engagement.status,
          tokenSymbol: fiatValues.tokenSymbol,
          totalEscrowedFiat: fiatValues.escrowedFiat,
          totalReleasedFiat: fiatValues.releasedFiat,
        };
      }),
    );

    return {
      fromDate: startDate,
      toDate: endDate,
      fiat: fiatCurrency,
      summary: {
        totalEscrowed: totalEscrowed.toString(),
        totalReleased: totalReleased.toString(),
        totalEngagements: engagements.length,
        totalEscrowedFiat: totalEscrowedFiat == null ? null : roundFiat(totalEscrowedFiat),
        totalReleasedFiat: totalReleasedFiat == null ? null : roundFiat(totalReleasedFiat),
      },
      engagementBreakdown,
    };
  }

  /**
   * Convert stroops amounts to a fiat-equivalent using the token's cached
   * exchange rate. Returns nulls (never throws) when the token or rate is
   * unavailable so reporting degrades gracefully.
   */
  private async toFiatValues(
    tokenAddress: string,
    escrowed: bigint,
    released: bigint,
    fiat: string,
  ): Promise<{ escrowedFiat: number | null; releasedFiat: number | null; tokenSymbol: string | null }> {
    try {
      const token = this.stellar.getTokenConfig(tokenAddress);
      const rate = await this.exchangeRates.getRate(token.symbol, fiat);
      if (rate == null) {
        return { escrowedFiat: null, releasedFiat: null, tokenSymbol: token.symbol };
      }

      const escrowedHuman = parseFloat(this.stellar.stroopsToHuman(escrowed, tokenAddress));
      const releasedHuman = parseFloat(this.stellar.stroopsToHuman(released, tokenAddress));
      return {
        escrowedFiat: roundFiat(escrowedHuman * rate),
        releasedFiat: roundFiat(releasedHuman * rate),
        tokenSymbol: token.symbol,
      };
    } catch (error: any) {
      this.logger.warn(
        `Fiat conversion skipped for token ${tokenAddress}: ${error?.message ?? String(error)}`,
      );
      return { escrowedFiat: null, releasedFiat: null, tokenSymbol: null };
    }
  }

  async exportBillingToCsv(companyUser: User, fromDate?: Date, toDate?: Date, fiat?: string) {
    const billingData = await this.getBillingSummary(companyUser, fromDate, toDate, fiat);

    const fiatCurrency = billingData.fiat;

    // Build CSV header — fiat columns only when a fiat currency is requested.
    const headers = [
      'Engagement ID',
      'Job Title',
      'Created At',
      'Token',
      'Total Escrowed',
      'Total Released',
      'Status',
      ...(fiatCurrency
        ? [`Total Escrowed (${fiatCurrency})`, `Total Released (${fiatCurrency})`]
        : []),
    ];

    // Build CSV rows
    const rows = billingData.engagementBreakdown.map((item) => [
      item.engagementId,
      `"${item.jobTitle.replace(/"/g, '""')}"`, // Escape quotes
      item.createdAt.toISOString(),
      item.tokenSymbol ?? '',
      item.totalEscrowed,
      item.totalReleased,
      item.status,
      ...(fiatCurrency
        ? [item.totalEscrowedFiat ?? '', item.totalReleasedFiat ?? '']
        : []),
    ]);

    // Add summary row
    const summaryRow = [
      'Summary',
      '',
      '',
      '',
      billingData.summary.totalEscrowed,
      billingData.summary.totalReleased,
      `${billingData.summary.totalEngagements} engagements`,
      ...(fiatCurrency
        ? [billingData.summary.totalEscrowedFiat ?? '', billingData.summary.totalReleasedFiat ?? '']
        : []),
    ];

    // Combine all parts
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
      '',
      summaryRow.join(','),
    ].join('\n');

    return csvContent;
  }

  /**
   * Export billing history as a CSV.
   *
   * Scoping rules:
   *   - COMPANY: only their own engagements (filtered by stellarAddress)
   *   - ADMIN:   all engagements in the system
   *
   * Columns (acceptance criteria): date, engagement reference, amount, status
   */
  async exportBillingHistory(
    requestingUser: User,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<string> {
    const isAdmin = requestingUser.role === UserRole.ADMIN;

    const now = new Date();
    const startDate = fromDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate =
      toDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where: Parameters<typeof this.prisma.engagement.findMany>[0]['where'] = {
      createdAt: { gte: startDate, lte: endDate },
      // Admins see everything; companies see only their own
      ...(!isAdmin && { companyAddress: requestingUser.stellarAddress }),
    };

    const engagements = await this.prisma.engagement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const CSV_HEADER = buildCsvRow([
      'Date',
      'Engagement Reference',
      'Amount (stroops)',
      'Status',
    ]);

    const rows = engagements.map((e) =>
      buildCsvRow([
        e.createdAt.toISOString(),
        e.id,
        e.totalAmount.toString(),
        e.status,
      ]),
    );

    return [CSV_HEADER, ...rows].join('\n');
  }
}
