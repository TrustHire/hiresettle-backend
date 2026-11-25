import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Payout, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { loadPayoutAnchors, PayoutAnchorConfig } from './payout-anchors.config';
import { Sep24ClientService, Sep24Transaction } from './sep24-client.service';
import { WithdrawDto } from './dto/withdraw.dto';

export const TERMINAL_PAYOUT_STATUSES: PayoutStatus[] = [
  PayoutStatus.COMPLETED,
  PayoutStatus.FAILED,
  PayoutStatus.EXPIRED,
];

/** Maps a raw SEP-24 status onto our coarser PayoutStatus. */
export function mapSep24Status(status: string): PayoutStatus {
  switch (status) {
    case 'incomplete':
      return PayoutStatus.INTERACTIVE;
    case 'pending_user_transfer_start':
      return PayoutStatus.PENDING_USER_TRANSFER;
    case 'completed':
      return PayoutStatus.COMPLETED;
    case 'expired':
      return PayoutStatus.EXPIRED;
    case 'error':
    case 'refunded':
    case 'no_market':
    case 'too_small':
    case 'too_large':
      return PayoutStatus.FAILED;
    default:
      // pending_anchor, pending_stellar, pending_external, pending_trust,
      // pending_user, pending_user_transfer_complete, on_hold, ...
      return PayoutStatus.PENDING_ANCHOR;
  }
}

/** Fields safe to return to API clients (never the anchor JWT). */
const PUBLIC_SELECT = {
  id: true,
  anchorId: true,
  assetCode: true,
  amount: true,
  status: true,
  anchorTransactionId: true,
  anchorStatus: true,
  interactiveUrl: true,
  moreInfoUrl: true,
  amountIn: true,
  amountOut: true,
  amountFee: true,
  withdrawAnchorAccount: true,
  withdrawMemo: true,
  withdrawMemoType: true,
  stellarTransactionId: true,
  externalTransactionId: true,
  message: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  private readonly anchors: PayoutAnchorConfig[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly sep24: Sep24ClientService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.anchors = loadPayoutAnchors(config);
  }

  listAnchors() {
    return this.anchors.map(({ id, name, homeDomain, assets }) => ({ id, name, homeDomain, assets }));
  }

  getAnchor(anchorId: string): PayoutAnchorConfig {
    const anchor = this.anchors.find((a) => a.id === anchorId);
    if (!anchor) throw new BadRequestException(`Unknown payout anchor: ${anchorId}`);
    return anchor;
  }

  /** Step 1: SEP-10 challenge the recruiter's wallet must sign. */
  async createChallenge(userId: string, anchorId: string) {
    const anchor = this.getAnchor(anchorId);
    const account = await this.recruiterAccount(userId);
    const challenge = await this.sep24.getChallenge(anchor, account);
    return { anchorId: anchor.id, account, ...challenge };
  }

  /**
   * Step 2: authenticate with the anchor using the signed challenge, open a
   * SEP-24 interactive withdrawal, and persist the payout record.
   */
  async withdraw(userId: string, dto: WithdrawDto) {
    const anchor = this.getAnchor(dto.anchorId);
    const assetCode = (dto.assetCode ?? 'USDC').toUpperCase();
    if (!anchor.assets.map((a) => a.toUpperCase()).includes(assetCode)) {
      throw new BadRequestException(`Anchor ${anchor.id} does not support ${assetCode} withdrawals`);
    }
    const account = await this.recruiterAccount(userId);

    const token = await this.sep24.exchangeChallenge(anchor, dto.signedChallenge);
    const { id, url } = await this.sep24.startWithdrawal(anchor, token, {
      assetCode,
      account,
      amount: dto.amount,
      lang: dto.lang,
    });

    const payout = await this.prisma.payout.create({
      data: {
        recruiterId: userId,
        anchorId: anchor.id,
        assetCode,
        amount: dto.amount ?? null,
        anchorTransactionId: id,
        anchorToken: token,
        interactiveUrl: url,
        anchorStatus: 'incomplete',
      },
      select: PUBLIC_SELECT,
    });

    this.logger.log(`Payout ${payout.id} opened with anchor ${anchor.id} (tx ${id}) for user ${userId}`);
    return payout;
  }

  async list(userId: string) {
    return this.prisma.payout.findMany({
      where: { recruiterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: PUBLIC_SELECT,
    });
  }

  async get(userId: string, id: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
      select: { ...PUBLIC_SELECT, recruiterId: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.recruiterId !== userId) throw new ForbiddenException();
    const { recruiterId: _omit, ...rest } = payout;
    return rest;
  }

  /**
   * Poll the anchor for one payout and persist the result. Sends the
   * completion/failure notification exactly once: the status update is
   * conditional on the previous status, so a concurrent poll cannot notify twice.
   */
  async refreshFromAnchor(payout: Payout): Promise<void> {
    const anchor = this.anchors.find((a) => a.id === payout.anchorId);
    if (!anchor) {
      this.logger.warn(`Payout ${payout.id} references removed anchor ${payout.anchorId}`);
      await this.prisma.payout.update({ where: { id: payout.id }, data: { lastPolledAt: new Date() } });
      return;
    }

    const tx = await this.sep24.getTransaction(anchor, payout.anchorToken, payout.anchorTransactionId);
    await this.applyAnchorState(payout, tx);
  }

  async applyAnchorState(payout: Payout, tx: Sep24Transaction): Promise<void> {
    const nextStatus = mapSep24Status(tx.status);
    const now = new Date();

    const { count } = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: payout.status },
      data: {
        status: nextStatus,
        anchorStatus: tx.status,
        moreInfoUrl: tx.more_info_url ?? payout.moreInfoUrl,
        amountIn: tx.amount_in ?? payout.amountIn,
        amountOut: tx.amount_out ?? payout.amountOut,
        amountFee: tx.amount_fee ?? payout.amountFee,
        withdrawAnchorAccount: tx.withdraw_anchor_account ?? payout.withdrawAnchorAccount,
        withdrawMemo: tx.withdraw_memo ?? payout.withdrawMemo,
        withdrawMemoType: tx.withdraw_memo_type ?? payout.withdrawMemoType,
        stellarTransactionId: tx.stellar_transaction_id ?? payout.stellarTransactionId,
        externalTransactionId: tx.external_transaction_id ?? payout.externalTransactionId,
        message: tx.message ?? payout.message,
        lastPolledAt: now,
        ...(nextStatus === PayoutStatus.COMPLETED ? { completedAt: now } : {}),
      },
    });

    if (count === 1 && nextStatus !== payout.status && TERMINAL_PAYOUT_STATUSES.includes(nextStatus)) {
      await this.notifyOutcome({ ...payout, status: nextStatus, amountOut: tx.amount_out ?? payout.amountOut, message: tx.message ?? payout.message });
    }
  }

  /** Give up on a payout the anchor never finalised within the polling window. */
  async expire(payout: Payout, reason: string): Promise<void> {
    const { count } = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: payout.status },
      data: { status: PayoutStatus.EXPIRED, message: reason, lastPolledAt: new Date() },
    });
    if (count === 1) {
      await this.notifyOutcome({ ...payout, status: PayoutStatus.EXPIRED, message: reason });
    }
  }

  private async notifyOutcome(payout: Pick<Payout, 'id' | 'recruiterId' | 'anchorId' | 'assetCode' | 'amount' | 'amountOut' | 'status' | 'message'>) {
    const anchorName = this.anchors.find((a) => a.id === payout.anchorId)?.name ?? payout.anchorId;
    const data = { payoutId: payout.id, anchorId: payout.anchorId, status: payout.status };

    if (payout.status === PayoutStatus.COMPLETED) {
      const amount = payout.amountOut ?? payout.amount;
      await this.notifications.notifyUserById(
        payout.recruiterId,
        NotificationType.PAYOUT_COMPLETED,
        'Withdrawal completed',
        `Your ${payout.assetCode} withdrawal via ${anchorName} has completed${amount ? ` (${amount} paid out)` : ''}.`,
        data,
      );
      return;
    }

    await this.notifications.notifyUserById(
      payout.recruiterId,
      NotificationType.PAYOUT_FAILED,
      'Withdrawal failed',
      `Your ${payout.assetCode} withdrawal via ${anchorName} did not complete` +
        `${payout.message ? `: ${payout.message}` : '.'} Any funds the anchor received will be refunded by the anchor.`,
      data,
    );
  }

  private async recruiterAccount(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true },
    });
    if (!user?.stellarAddress) {
      throw new BadRequestException('Link a Stellar wallet to your account before withdrawing');
    }
    return user.stellarAddress;
  }
}
