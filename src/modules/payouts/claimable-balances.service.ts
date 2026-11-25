import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimableBalance, ClaimableBalanceStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { DistributedLockService } from '../../common/lock/distributed-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claimInstructions } from './payout-delivery.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

/** Tracks claimable balances created for recruiters without a trustline and sends reminders. */
@Injectable()
export class ClaimableBalancesService {
  private readonly logger = new Logger(ClaimableBalancesService.name);
  private readonly reminderEveryMs: number;
  private readonly maxReminders: number;
  private readonly reclaimMs: number;
  private readonly reclaimDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    private readonly lock: DistributedLockService,
    config: ConfigService,
  ) {
    this.reminderEveryMs = Number(config.get('CLAIMABLE_BALANCE_REMINDER_DAYS', 3)) * DAY_MS;
    this.maxReminders = Number(config.get('CLAIMABLE_BALANCE_MAX_REMINDERS', 5));
    this.reclaimDays = Number(config.get('CLAIMABLE_BALANCE_RECLAIM_DAYS', 90));
    this.reclaimMs = this.reclaimDays * DAY_MS;
  }

  /** Recruiter view of their pending and past claimable balances. */
  async listForUser(userId: string, stellarAddress?: string | null) {
    if (!userId) throw new ForbiddenException();
    const rows = await this.prisma.claimableBalance.findMany({
      where: { OR: [{ recruiterId: userId }, ...(stellarAddress ? [{ recipientAddress: stellarAddress }] : [])] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({ ...r, amount: r.amount.toString() }));
  }

  /** Admin view of everything still unclaimed. */
  async listUnclaimed() {
    const rows = await this.prisma.claimableBalance.findMany({
      where: { status: ClaimableBalanceStatus.UNCLAIMED },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ ...r, amount: r.amount.toString() }));
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'claimable-balance-tracker' })
  async run(): Promise<void> {
    await this.lock.withLock('cron:claimable-balance-tracker', 30 * 60 * 1000, () => this.sweep());
  }

  async sweep(now = new Date()): Promise<{ claimed: number; reminded: number }> {
    const pending = await this.prisma.claimableBalance.findMany({
      where: { status: ClaimableBalanceStatus.UNCLAIMED },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    let claimed = 0;
    let reminded = 0;
    for (const cb of pending) {
      try {
        const onChain = await this.stellar.getClaimableBalance(cb.balanceId);
        if (!onChain) {
          await this.markGone(cb, now);
          claimed++;
          continue;
        }
        if (this.reminderDue(cb, now)) {
          await this.remind(cb, now);
          reminded++;
        }
      } catch (err) {
        this.logger.warn(`Could not check claimable balance ${cb.balanceId}: ${(err as Error).message}`);
      }
    }
    return { claimed, reminded };
  }

  private reminderDue(cb: ClaimableBalance, now: Date): boolean {
    if (cb.remindersSent >= this.maxReminders) return false;
    const last = (cb.lastRemindedAt ?? cb.createdAt).getTime();
    return now.getTime() - last >= this.reminderEveryMs;
  }

  /** Gone from Horizon: claimed by the recruiter, or reclaimed by the relay after the window. */
  private async markGone(cb: ClaimableBalance, now: Date) {
    const reclaimed = now.getTime() - cb.createdAt.getTime() >= this.reclaimMs;
    await this.prisma.claimableBalance.update({
      where: { id: cb.id },
      data: {
        status: reclaimed ? ClaimableBalanceStatus.RECLAIMED : ClaimableBalanceStatus.CLAIMED,
        claimedAt: now,
      },
    });
    if (reclaimed) {
      this.logger.warn(
        `Claimable balance ${cb.balanceId} for ${cb.engagementId}[${cb.milestoneIndex}] was not claimed and is back with the relay`,
      );
    }
  }

  private async remind(cb: ClaimableBalance, now: Date) {
    const { count } = await this.prisma.claimableBalance.updateMany({
      where: { id: cb.id, remindersSent: cb.remindersSent },
      data: { remindersSent: { increment: 1 }, lastRemindedAt: now },
    });
    if (count !== 1) return;

    const [code, issuer] = cb.asset.split(':');
    const human = this.stellar.stroopsToUsdc(cb.amount);
    const daysLeft = Math.max(0, Math.ceil((cb.createdAt.getTime() + this.reclaimMs - now.getTime()) / DAY_MS));

    await this.notifications.notifyUser(
      cb.recipientAddress,
      NotificationType.CLAIMABLE_BALANCE_REMINDER,
      `Reminder: ${human} ${code} is waiting to be claimed`,
      `${claimInstructions({ human, code, issuer, balanceId: cb.balanceId, reclaimDays: this.reclaimDays })} ` +
        `${daysLeft} day(s) left.`,
      { balanceId: cb.balanceId, engagementId: cb.engagementId, milestoneIndex: cb.milestoneIndex, daysLeft },
    );
  }
}
