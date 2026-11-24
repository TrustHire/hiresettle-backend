import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma, User, UserRole } from '@prisma/client';

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

  constructor(private readonly prisma: PrismaService) {}

  async getBillingSummary(
    companyUser: User,
    fromDate?: Date,
    toDate?: Date,
  ) {
    // Get current calendar month if no dates provided
    const now = new Date();
    const startDate = fromDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = toDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Find engagements where the user is the company
    const engagements = await this.prisma.engagement.findMany({
      where: {
        companyAddress: companyUser.stellarAddress ?? undefined,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        milestones: true,
        costCenter: { select: { code: true, name: true } },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate aggregates
    let totalEscrowed = BigInt(0);
    let totalReleased = BigInt(0);

    const engagementBreakdown = engagements.map((engagement) => {
      const escrowed = engagement.totalAmount;
      const released = engagement.releasedAmount;

      totalEscrowed += escrowed;
      totalReleased += released;

      return {
        engagementId: engagement.id,
        jobTitle: engagement.jobTitle,
        createdAt: engagement.createdAt,
        totalEscrowed: escrowed.toString(),
        totalReleased: released.toString(),
        status: engagement.status,
        costCenter: (engagement as any).costCenter?.code ?? '',
      };
    });

    return {
      fromDate: startDate,
      toDate: endDate,
      summary: {
        totalEscrowed: totalEscrowed.toString(),
        totalReleased: totalReleased.toString(),
        totalEngagements: engagements.length,
      },
      engagementBreakdown,
    };
  }

  async exportBillingToCsv(companyUser: User, fromDate?: Date, toDate?: Date) {
    const billingData = await this.getBillingSummary(companyUser, fromDate, toDate);
    
    // Build CSV header
    const headers = ['Engagement ID', 'Job Title', 'Created At', 'Total Escrowed', 'Total Released', 'Status', 'Cost Center'];
    
    // Build CSV rows
    const rows = billingData.engagementBreakdown.map((item) => [
      item.engagementId,
      `"${item.jobTitle.replace(/"/g, '""')}"`, // Escape quotes
      item.createdAt.toISOString(),
      item.totalEscrowed,
      item.totalReleased,
      item.status,
      csvCell(item.costCenter),
    ]);

    // Add summary row
    const summaryRow = [
      'Summary',
      '',
      '',
      billingData.summary.totalEscrowed,
      billingData.summary.totalReleased,
      `${billingData.summary.totalEngagements} engagements`,
      '',
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

    const where: Prisma.EngagementWhereInput = {
      createdAt: { gte: startDate, lte: endDate },
      // Admins see everything; companies see only their own
      ...(!isAdmin && { companyAddress: requestingUser.stellarAddress ?? undefined }),
    };

    const engagements = await this.prisma.engagement.findMany({
      where,
      include: { costCenter: { select: { code: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const CSV_HEADER = buildCsvRow([
      'Date',
      'Engagement Reference',
      'Amount (stroops)',
      'Status',
      'Cost Center',
    ]);

    const rows = engagements.map((e: any) =>
      buildCsvRow([
        e.createdAt.toISOString(),
        e.id,
        e.totalAmount.toString(),
        e.status,
        e.costCenter?.code ?? '',
      ]),
    );

    return [CSV_HEADER, ...rows].join('\n');
  }
}
