import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { StellarError, StellarErrorCode } from '../../common/stellar/stellar.error';
import { NotificationsService } from '../notifications/notifications.service';

export type ReleaseResult =
  | { mode: 'direct'; txHash: string }
  | { mode: 'claimable_balance'; txHash: string; balanceId: string };

const CB_CREATE_ATTEMPTS = 3;

/**
 * Releases milestone payments safely for non-native assets.
 *
 * A direct release to a recruiter without a trustline for the engagement's
 * asset fails on-chain. Before releasing we check the trustline; when it is
 * missing we release to the platform relay account instead and hand the funds
 * to the recruiter as a claimable balance they can claim once they add the
 * trustline. The relay can reclaim after CLAIMABLE_BALANCE_RECLAIM_DAYS so
 * funds are never stranded.
 */
@Injectable()
export class PayoutDeliveryService {
  private readonly logger = new Logger(PayoutDeliveryService.name);
  private readonly reclaimDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.reclaimDays = Number(config.get('CLAIMABLE_BALANCE_RECLAIM_DAYS', 90));
  }

  async releaseMilestone(engagementId: string, milestoneIndex: number): Promise<ReleaseResult> {
    // Idempotency: a previous attempt already delivered via claimable balance.
    const existing = await this.prisma.claimableBalance.findUnique({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
    });
    if (existing) {
      return { mode: 'claimable_balance', txHash: existing.txHash, balanceId: existing.balanceId };
    }

    const milestone = await this.prisma.milestone.findUnique({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      select: {
        amount: true,
        engagement: { select: { recruiterAddress: true, recruiterId: true, tokenAddress: true } },
      },
    });

    if (!milestone) {
      // Unknown locally — keep legacy behaviour and let the contract decide.
      return { mode: 'direct', txHash: await this.stellar.releaseMilestonePayment(engagementId, milestoneIndex) };
    }

    const { recruiterAddress, tokenAddress } = milestone.engagement;
    const hasTrustline = await this.stellar.hasTrustline(recruiterAddress, tokenAddress);
    if (hasTrustline) {
      return { mode: 'direct', txHash: await this.stellar.releaseMilestonePayment(engagementId, milestoneIndex) };
    }

    return this.releaseAsClaimableBalance({
      engagementId,
      milestoneIndex,
      recruiterAddress,
      recruiterId: milestone.engagement.recruiterId,
      tokenAddress,
      amount: BigInt(milestone.amount ?? 0),
    });
  }

  private async releaseAsClaimableBalance(params: {
    engagementId: string;
    milestoneIndex: number;
    recruiterAddress: string;
    recruiterId: string | null;
    tokenAddress: string;
    amount: bigint;
  }): Promise<ReleaseResult> {
    const { engagementId, milestoneIndex, recruiterAddress, tokenAddress, amount } = params;
    if (amount <= 0n) {
      throw new StellarError(
        `Milestone ${engagementId}[${milestoneIndex}] has no amount; cannot create a claimable balance`,
        StellarErrorCode.TRANSACTION_FAILED,
      );
    }

    const relay = this.stellar.getBackendAccountAddress();
    if (!relay) {
      throw new StellarError(
        'Recruiter has no trustline and the relay keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    this.logger.warn(
      `Recruiter ${recruiterAddress} has no trustline for ${tokenAddress}; routing ${engagementId}[${milestoneIndex}] via claimable balance`,
    );

    const releaseTxHash = await this.stellar.releaseMilestonePaymentTo(engagementId, milestoneIndex, relay);

    // The escrow release is final from here on. Retry the hand-over before giving up so
    // callers do not re-attempt the (now non-repeatable) contract release.
    let created: { balanceId: string; txHash: string } | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= CB_CREATE_ATTEMPTS && !created; attempt++) {
      try {
        created = await this.stellar.createClaimableBalance({
          recipient: recruiterAddress,
          tokenAddress,
          amountStroops: amount,
          reclaimAfterSeconds: this.reclaimDays * 24 * 60 * 60,
          memo: `hs:${engagementId}`,
        });
      } catch (err) {
        lastError = err;
        this.logger.error(
          `Claimable balance attempt ${attempt}/${CB_CREATE_ATTEMPTS} failed for ${engagementId}[${milestoneIndex}]: ${(err as Error).message}`,
        );
      }
    }
    if (!created) {
      this.logger.error(
        `MANUAL ACTION REQUIRED: ${amount} stroops of ${tokenAddress} for ${engagementId}[${milestoneIndex}] ` +
          `were released to relay ${relay} (tx ${releaseTxHash}) but the claimable balance could not be created`,
      );
      throw lastError;
    }

    await this.prisma.claimableBalance.create({
      data: {
        balanceId: created.balanceId,
        recruiterId: params.recruiterId,
        recipientAddress: recruiterAddress,
        engagementId,
        milestoneIndex,
        asset: tokenAddress,
        amount,
        txHash: created.txHash,
      },
    });

    await this.notifyCreated({ ...params, balanceId: created.balanceId });
    return { mode: 'claimable_balance', txHash: releaseTxHash, balanceId: created.balanceId };
  }

  private async notifyCreated(p: {
    engagementId: string;
    milestoneIndex: number;
    recruiterAddress: string;
    tokenAddress: string;
    amount: bigint;
    balanceId: string;
  }) {
    const [code, issuer] = p.tokenAddress.split(':');
    const human = this.stellar.stroopsToUsdc(p.amount);
    await this.notifications.notifyUser(
      p.recruiterAddress,
      NotificationType.CLAIMABLE_BALANCE_CREATED,
      `Claim your ${human} ${code} payment`,
      claimInstructions({ human, code, issuer, balanceId: p.balanceId, reclaimDays: this.reclaimDays }) +
        ` (Milestone ${p.milestoneIndex} on engagement ${p.engagementId}.)`,
      {
        engagementId: p.engagementId,
        milestoneIndex: p.milestoneIndex,
        balanceId: p.balanceId,
        assetCode: code,
        assetIssuer: issuer,
        amount: human,
      },
    );
  }
}

export function claimInstructions(p: {
  human: string;
  code: string;
  issuer: string;
  balanceId: string;
  reclaimDays: number;
}): string {
  return (
    `Your wallet has no trustline for ${p.code}, so ${p.human} ${p.code} is waiting for you as a claimable balance. ` +
    `To receive it: 1) add a trustline for ${p.code} issued by ${p.issuer} in your Stellar wallet; ` +
    `2) claim balance ${p.balanceId} (most wallets show pending claimable balances automatically). ` +
    `Unclaimed funds return to HireSettle after ${p.reclaimDays} days.`
  );
}
