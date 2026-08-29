import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Response } from 'express';

const MAX_RANGE_DAYS = 90;

type RevenueGranularity = 'daily' | 'monthly';

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(values: unknown[]): string {
  return values.map(escapeCsv).join(',');
}

function parseAndValidateDateRange(
  from: string,
  to: string,
): { fromDate: Date; toDate: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new BadRequestException(
      'Invalid date format. Use ISO 8601 (e.g. 2026-01-01).',
    );
  }
  if (fromDate > toDate) {
    throw new BadRequestException('"from" must be before "to".');
  }
  const diffMs = toDate.getTime() - fromDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `Date range cannot exceed ${MAX_RANGE_DAYS} days.`,
    );
  }
  return { fromDate, toDate };
}

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRevenueDashboard(
    from: string,
    to: string,
    granularity: RevenueGranularity = 'daily',
  ) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException(
        'Invalid date format. Use ISO 8601 (e.g. 2026-01-01).',
      );
    }
    if (fromDate > toDate) {
      throw new BadRequestException('"from" must be before "to".');
    }
    if (!['daily', 'monthly'].includes(granularity)) {
      throw new BadRequestException('"granularity" must be daily or monthly.');
    }

    // Date-only end dates should include the complete UTC day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      toDate.setUTCHours(23, 59, 59, 999);
    }

    const milestones = await this.prisma.replica.milestone.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: fromDate, lte: toDate },
        paymentReleased: { not: null },
      },
      select: { confirmedAt: true, paymentReleased: true },
      orderBy: { confirmedAt: 'asc' },
    });

    const buckets = new Map<string, bigint>();
    const cursor = new Date(fromDate);
    if (granularity === 'daily') cursor.setUTCHours(0, 0, 0, 0);
    else cursor.setUTCDate(1), cursor.setUTCHours(0, 0, 0, 0);

    while (cursor <= toDate) {
      const period = this.revenuePeriod(cursor, granularity);
      buckets.set(period, 0n);
      if (granularity === 'daily') cursor.setUTCDate(cursor.getUTCDate() + 1);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    let total = 0n;
    for (const milestone of milestones) {
      if (!milestone.confirmedAt || milestone.paymentReleased === null) continue;
      const period = this.revenuePeriod(milestone.confirmedAt, granularity);
      const amount = milestone.paymentReleased;
      buckets.set(period, (buckets.get(period) ?? 0n) + amount);
      total += amount;
    }

    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      granularity,
      total: total.toString(),
      buckets: [...buckets].map(([period, amount]) => ({
        period,
        amount: amount.toString(),
      })),
    };
  }

  private revenuePeriod(date: Date, granularity: RevenueGranularity): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    if (granularity === 'monthly') return `${year}-${month}`;
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async streamEngagementsCsv(
    from: string,
    to: string,
    res: Response,
  ): Promise<void> {
    const { fromDate, toDate } = parseAndValidateDateRange(from, to);

    const engagements = await this.prisma.replica.engagement.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      orderBy: { createdAt: 'asc' },
      include: {
        company: { select: { email: true } },
        recruiter: { select: { email: true } },
      },
    });

    const headers = [
      'id',
      'status',
      'jobTitle',
      'companyAddress',
      'companyEmail',
      'recruiterAddress',
      'recruiterEmail',
      'arbiterAddress',
      'tokenAddress',
      'totalAmount',
      'releasedAmount',
      'txHash',
      'createdLedger',
      'createdAt',
      'updatedAt',
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="engagements.csv"',
    );
    res.write(headers.join(',') + '\n');

    for (const e of engagements) {
      res.write(
        rowToCsv([
          e.id,
          e.status,
          e.jobTitle,
          e.companyAddress,
          e.company?.email,
          e.recruiterAddress,
          e.recruiter?.email,
          e.arbiterAddress,
          e.tokenAddress,
          e.totalAmount.toString(),
          e.releasedAmount.toString(),
          e.txHash,
          e.createdLedger,
          e.createdAt.toISOString(),
          e.updatedAt.toISOString(),
        ]) + '\n',
      );
    }

    res.end();
  }

  async streamPaymentsCsv(
    from: string,
    to: string,
    res: Response,
  ): Promise<void> {
    const { fromDate, toDate } = parseAndValidateDateRange(from, to);

    const milestones = await this.prisma.replica.milestone.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: fromDate, lte: toDate },
        paymentReleased: { not: null },
      },
      orderBy: { confirmedAt: 'asc' },
      include: {
        engagement: {
          select: {
            id: true,
            companyAddress: true,
            recruiterAddress: true,
            txHash: true,
          },
        },
      },
    });

    const headers = [
      'milestoneId',
      'engagementId',
      'milestoneIndex',
      'name',
      'kind',
      'paymentPercent',
      'paymentReleased',
      'companyAddress',
      'recruiterAddress',
      'engagementTxHash',
      'confirmedAt',
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.write(headers.join(',') + '\n');

    for (const m of milestones) {
      res.write(
        rowToCsv([
          m.id,
          m.engagementId,
          m.milestoneIndex,
          m.name,
          m.kind,
          m.paymentPercent,
          m.paymentReleased?.toString(),
          m.engagement.companyAddress,
          m.engagement.recruiterAddress,
          m.engagement.txHash,
          m.confirmedAt?.toISOString(),
        ]) + '\n',
      );
    }

    res.end();
  }

  async streamDisputesCsv(
    from: string,
    to: string,
    res: Response,
  ): Promise<void> {
    const { fromDate, toDate } = parseAndValidateDateRange(from, to);

    const milestones = await this.prisma.replica.milestone.findMany({
      where: {
        status: { in: ['DISPUTED', 'RESOLVED'] },
        updatedAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { updatedAt: 'asc' },
      include: {
        engagement: {
          select: {
            id: true,
            companyAddress: true,
            recruiterAddress: true,
            arbiterAddress: true,
          },
        },
      },
    });

    const headers = [
      'milestoneId',
      'engagementId',
      'milestoneIndex',
      'name',
      'status',
      'companyAddress',
      'recruiterAddress',
      'arbiterAddress',
      'proofHash',
      'updatedAt',
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="disputes.csv"');
    res.write(headers.join(',') + '\n');

    for (const m of milestones) {
      res.write(
        rowToCsv([
          m.id,
          m.engagementId,
          m.milestoneIndex,
          m.name,
          m.status,
          m.engagement.companyAddress,
          m.engagement.recruiterAddress,
          m.engagement.arbiterAddress,
          m.proofHash,
          m.updatedAt.toISOString(),
        ]) + '\n',
      );
    }

    res.end();
  }
}
