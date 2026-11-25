import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DistributedLockService } from '../../common/lock/distributed-lock.service';
import { PayoutsService, TERMINAL_PAYOUT_STATUSES } from './payouts.service';
import { AnchorHttpError } from './sep24-client.service';

const BATCH_SIZE = 50;
const MIN_POLL_INTERVAL_MS = 45_000;
const LOCK_KEY = 'cron:payout-poller';
const LOCK_TTL_MS = 5 * 60 * 1000;

/** Polls anchors for in-flight SEP-24 withdrawals and updates payout records. */
@Injectable()
export class PayoutPollerService {
  private readonly logger = new Logger(PayoutPollerService.name);
  private readonly maxAgeMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly lock: DistributedLockService,
    config: ConfigService,
  ) {
    this.maxAgeMs = Number(config.get('PAYOUT_POLL_MAX_AGE_HOURS', 168)) * 60 * 60 * 1000;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'payout-poller' })
  async poll(): Promise<void> {
    await this.lock.withLock(LOCK_KEY, LOCK_TTL_MS, () => this.pollOnce());
  }

  async pollOnce(): Promise<number> {
    const now = Date.now();
    const due = await this.prisma.payout.findMany({
      where: {
        status: { notIn: TERMINAL_PAYOUT_STATUSES },
        OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(now - MIN_POLL_INTERVAL_MS) } }],
      },
      orderBy: [{ lastPolledAt: { sort: 'asc', nulls: 'first' } }],
      take: BATCH_SIZE,
    });

    for (const payout of due) {
      if (now - payout.createdAt.getTime() > this.maxAgeMs) {
        await this.payouts.expire(payout, 'The anchor did not complete the withdrawal in time');
        continue;
      }

      try {
        await this.payouts.refreshFromAnchor(payout);
      } catch (err) {
        const unauthorized = err instanceof AnchorHttpError && [401, 403].includes(err.anchorStatus);
        this.logger.warn(
          `Polling payout ${payout.id} failed${unauthorized ? ' (anchor token expired)' : ''}: ${(err as Error).message}`,
        );
        await this.prisma.payout.update({
          where: { id: payout.id },
          data: {
            lastPolledAt: new Date(),
            ...(unauthorized && payout.status === PayoutStatus.INTERACTIVE
              ? { status: PayoutStatus.EXPIRED, message: 'Anchor session expired before the withdrawal was started' }
              : {}),
          },
        });
      }
    }
    return due.length;
  }
}
