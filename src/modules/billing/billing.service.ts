import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { User } from '@prisma/client';

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
    const headers = ['Engagement ID', 'Job Title', 'Created At', 'Total Escrowed', 'Total Released', 'Status'];
    
    // Build CSV rows
    const rows = billingData.engagementBreakdown.map((item) => [
      item.engagementId,
      `"${item.jobTitle.replace(/"/g, '""')}"`, // Escape quotes
      item.createdAt.toISOString(),
      item.totalEscrowed,
      item.totalReleased,
      item.status,
    ]);

    // Add summary row
    const summaryRow = [
      'Summary',
      '',
      '',
      billingData.summary.totalEscrowed,
      billingData.summary.totalReleased,
      `${billingData.summary.totalEngagements} engagements`,
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
}
