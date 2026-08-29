import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const MERGE_CURSOR_KEY = 'stellar_merge_last_paging_token';

@Injectable()
export class StellarMergeDetectorService {
  private readonly logger = new Logger(StellarMergeDetectorService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectMergedAccounts(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Merge detector already running — skipping tick');
      return;
    }
    this.isRunning = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error('Merge detection failed', err?.message ?? err);
    } finally {
      this.isRunning = false;
    }
  }

  private async run(): Promise<void> {
    const horizonUrl = this.config.get<string>('STELLAR_HORIZON_URL');
    if (!horizonUrl) return;

    // Collect all unique stellar addresses from active engagements
    const engagements = await this.prisma.engagement.findMany({
      where: { status: { in: ['ACTIVE', 'REPLACEMENT_REQUESTED'] } },
      select: {
        id: true,
        companyAddress: true,
        recruiterAddress: true,
        arbiterAddress: true,
      },
    });

    if (!engagements.length) return;

    const addressSet = new Set<string>();
    for (const e of engagements) {
      addressSet.add(e.companyAddress);
      addressSet.add(e.recruiterAddress);
      addressSet.add(e.arbiterAddress);
    }

    // Read the last paging token cursor
    const cursorRow = await this.prisma.systemConfig.findUnique({
      where: { key: MERGE_CURSOR_KEY },
    });
    const pagingToken = cursorRow?.value ?? 'now';

    let newMaxToken = pagingToken;

    for (const address of addressSet) {
      try {
        const url = `${horizonUrl}/accounts/${encodeURIComponent(address)}/operations?order=asc&limit=200&include_failed=false${pagingToken !== 'now' ? `&cursor=${pagingToken}` : ''}`;
        const response = await fetch(url);
        if (!response.ok) continue;

        const data = await response.json();
        const records: any[] = data?._embedded?.records ?? [];

        for (const op of records) {
          if (op.type === 'account_merge') {
            this.logger.warn(
              `Account merge detected for address ${address}, op id: ${op.id}`,
            );
            await this.flagMergedEngagements(address, engagements);
          }
          if (op.paging_token && op.paging_token > newMaxToken) {
            newMaxToken = op.paging_token;
          }
        }
      } catch (err) {
        this.logger.debug(`Error checking address ${address}: ${err?.message}`);
      }
    }

    // Persist updated cursor
    if (newMaxToken !== pagingToken) {
      await this.prisma.systemConfig.upsert({
        where: { key: MERGE_CURSOR_KEY },
        create: { key: MERGE_CURSOR_KEY, value: newMaxToken },
        update: { value: newMaxToken },
      });
    }
  }

  private async flagMergedEngagements(
    mergedAddress: string,
    engagements: Array<{
      id: string;
      companyAddress: string;
      recruiterAddress: string;
      arbiterAddress: string;
    }>,
  ): Promise<void> {
    const affected = engagements.filter(
      (e) =>
        e.companyAddress === mergedAddress ||
        e.recruiterAddress === mergedAddress ||
        e.arbiterAddress === mergedAddress,
    );

    for (const engagement of affected) {
      // Idempotent: only update if not already flagged
      const current = await this.prisma.engagement.findUnique({
        where: { id: engagement.id },
        select: { status: true },
      });
      if (!current || current.status === 'ACCOUNT_MERGED') continue;

      await this.prisma.engagement.update({
        where: { id: engagement.id },
        data: { status: 'ACCOUNT_MERGED' },
      });

      this.logger.warn(`Flagged engagement ${engagement.id} as ACCOUNT_MERGED`);

      // Notify all admins
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deactivatedAt: null },
        select: { id: true },
      });

      for (const admin of admins) {
        await this.notifications.notifyUserById(
          admin.id,
          'ACCOUNT_MERGE_DETECTED',
          'Stellar Account Merge Detected',
          `Address ${mergedAddress} was merged. Engagement ${engagement.id} has been flagged as ACCOUNT_MERGED and requires review.`,
          { engagementId: engagement.id, mergedAddress },
        );
      }
    }
  }

  async listMergedEngagements() {
    const engagements = await this.prisma.engagement.findMany({
      where: { status: 'ACCOUNT_MERGED' },
      orderBy: { updatedAt: 'desc' },
      include: {
        company: { select: { email: true, name: true } },
        recruiter: { select: { email: true, name: true } },
        arbiter: { select: { email: true, name: true } },
        milestones: { select: { id: true, name: true, status: true } },
      },
    });

    return { data: engagements, total: engagements.length };
  }
}
