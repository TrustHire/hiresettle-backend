import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { StellarService } from '../../common/stellar/stellar.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const STROOPS_PER_XLM = 10_000_000;

export interface SponsoredSubmitResult {
  hash: string;
  sponsored: boolean;
  feeStroops: string | null;
}

/**
 * Platform-sponsored fees via fee-bump transactions (#386).
 *
 * Env:
 *  - ENABLE_FEE_SPONSORSHIP=true        turns sponsorship on
 *  - STELLAR_FEE_SPONSOR_SECRET         platform fee keypair (falls back to STELLAR_SECRET_KEY)
 *  - FEE_SPONSORSHIP_DAILY_CAP_XLM      daily cap in XLM (default 100)
 *  - FEE_SPONSORSHIP_MAX_FEE_STROOPS    max fee per fee-bump (default 100000)
 *  - FEE_SPONSORSHIP_WARN_RATIO         warn when spend reaches this ratio of the cap (default 0.8)
 */
@Injectable()
export class FeeSponsorshipService {
  private readonly logger = new Logger(FeeSponsorshipService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly stellar: StellarService,
    private readonly prisma: PrismaService,
  ) {}

  isEnabled(): boolean {
    return String(this.config.get('ENABLE_FEE_SPONSORSHIP') ?? 'false').toLowerCase() === 'true';
  }

  get dailyCapStroops(): number {
    return Number(this.config.get('FEE_SPONSORSHIP_DAILY_CAP_XLM') ?? 100) * STROOPS_PER_XLM;
  }

  get maxFeeStroops(): number {
    return Number(this.config.get('FEE_SPONSORSHIP_MAX_FEE_STROOPS') ?? 100_000);
  }

  private get warnRatio(): number {
    return Number(this.config.get('FEE_SPONSORSHIP_WARN_RATIO') ?? 0.8);
  }

  private sponsorKeypair(): Keypair {
    const secret =
      this.config.get<string>('STELLAR_FEE_SPONSOR_SECRET') ?? this.config.get<string>('STELLAR_SECRET_KEY');
    if (!secret) throw new BadRequestException('Fee sponsor keypair is not configured');
    return Keypair.fromSecret(secret);
  }

  /** Wraps a user-signed transaction in a fee-bump signed by the platform fee keypair. */
  wrap(inner: Transaction, feeStroops = this.maxFeeStroops): FeeBumpTransaction {
    const sponsor = this.sponsorKeypair();
    const ops = Math.max(inner.operations.length, 1);
    // buildFeeBumpTransaction takes a per-operation base fee.
    const baseFee = Math.max(Math.floor(feeStroops / (ops + 1)), Number(inner.fee) / ops, 100);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      String(Math.ceil(baseFee)),
      inner,
      this.stellar.getNetworkPassphrase(),
    );
    feeBump.sign(sponsor);
    return feeBump;
  }

  /** Total stroops spent on sponsored fees since UTC midnight. */
  async spentTodayStroops(now = new Date()): Promise<number> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const agg = await (this.prisma as any).sponsoredFee.aggregate({
      where: { createdAt: { gte: start } },
      _sum: { feeStroops: true },
    });
    return Number(agg?._sum?.feeStroops ?? 0);
  }

  /** Throws if sponsoring `feeStroops` would exceed the daily cap; logs a warning near the cap. */
  async assertWithinBudget(feeStroops: number): Promise<void> {
    const spent = await this.spentTodayStroops();
    const cap = this.dailyCapStroops;
    const projected = spent + feeStroops;
    if (projected > cap) {
      this.logger.error(
        `[ALERT] Fee sponsorship daily cap exceeded: ${spent / STROOPS_PER_XLM} XLM spent, cap ${cap / STROOPS_PER_XLM} XLM`,
      );
      throw new BadRequestException('Daily fee sponsorship budget exhausted');
    }
    if (projected >= cap * this.warnRatio) {
      this.logger.warn(
        `[ALERT] Fee sponsorship approaching daily cap: ${projected / STROOPS_PER_XLM}/${cap / STROOPS_PER_XLM} XLM`,
      );
    }
  }

  /**
   * Submits a user-signed transaction. When sponsorship is enabled it is wrapped in
   * a fee-bump (platform pays) and the fee is recorded against `companyId`; otherwise
   * the inner transaction is submitted as-is.
   */
  async submit(signedXdr: string, companyId: string): Promise<SponsoredSubmitResult> {
    const passphrase = this.stellar.getNetworkPassphrase();
    const parsed = TransactionBuilder.fromXDR(signedXdr, passphrase);
    if (parsed instanceof FeeBumpTransaction) {
      throw new BadRequestException('Transaction is already a fee-bump transaction');
    }
    const server = new Horizon.Server(this.stellar.getHorizonUrl(), { allowHttp: true });

    if (!this.isEnabled()) {
      const res: any = await server.submitTransaction(parsed);
      return { hash: res.hash, sponsored: false, feeStroops: null };
    }

    await this.assertWithinBudget(this.maxFeeStroops);
    const feeBump = this.wrap(parsed);
    const res: any = await server.submitTransaction(feeBump);
    const feeCharged = Number(res.fee_charged ?? feeBump.fee);

    await (this.prisma as any).sponsoredFee.create({
      data: {
        companyId,
        txHash: res.hash,
        innerTxHash: parsed.hash().toString('hex'),
        feeStroops: BigInt(feeCharged),
        feeSource: feeBump.feeSource,
      },
    });
    await this.assertWithinBudget(0).catch(() => undefined); // post-spend alert check

    return { hash: res.hash, sponsored: true, feeStroops: String(feeCharged) };
  }
}
