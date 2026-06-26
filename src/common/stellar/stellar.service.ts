import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Networks,
  SorobanRpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  scValToNative,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';

/**
 * StellarService
 *
 * Provides:
 *  - Soroban RPC client for querying the Stellar network
 *  - Contract event fetching (used by EventsService poller)
 *  - Read-only contract call simulation
 *  - Retention timer utilities:
 *      - ledgersToDateTime() — converts a ledger sequence to estimated wall-clock time
 *      - dateTimeToLedger()  — estimates the ledger for a given future datetime
 *  - USDC/stroops conversion helpers
 *
 * This service does NOT hold user funds. The backend Stellar keypair
 * is used only for read-only RPC calls.
 */
@Injectable()
export class StellarService implements OnModuleInit {
  private readonly logger = new Logger(StellarService.name);

  private rpcClient: SorobanRpc.Server;
  private networkPassphrase: string;
  private contractId: string;
  private backendKeypair: Keypair;
  private readonly LEDGERS_PER_DAY = 17_280; // 86400s ÷ 5s per ledger

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const rpcUrl = this.config.get<string>('STELLAR_RPC_URL');
    const networkName = this.config.get<string>('STELLAR_NETWORK', 'testnet');

    this.rpcClient = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    this.contractId = this.config.get<string>('HIRESETTLE_CONTRACT_ID');
    this.networkPassphrase =
      networkName === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const secretKey = this.config.get<string>('STELLAR_SECRET_KEY');
    if (secretKey) {
      this.backendKeypair = Keypair.fromSecret(secretKey);
    }

    this.logger.log(`Stellar connected to ${networkName} (${rpcUrl})`);
    this.logger.log(`Contract: ${this.contractId}`);
  }

  // ----------------------------------------------------------
  // RPC ACCESS
  // ----------------------------------------------------------

  getClient(): SorobanRpc.Server { return this.rpcClient; }
  getNetworkPassphrase(): string { return this.networkPassphrase; }
  getContractId(): string { return this.contractId; }

  // ----------------------------------------------------------
  // EVENT FETCHING
  // ----------------------------------------------------------

  /**
   * Fetch HireSettle contract events from a given ledger range.
   * Called by EventsService every 5 seconds.
   */
  async fetchContractEvents(
    startLedger: number,
  ): Promise<SorobanRpc.Api.EventResponse[]> {
    try {
      const result = await this.rpcClient.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
        limit: 100,
      });
      return result.events ?? [];
    } catch (error) {
      this.logger.error(`Failed to fetch events from ledger ${startLedger}`, error.message);
      return [];
    }
  }

  // ----------------------------------------------------------
  // READ-ONLY CONTRACT SIMULATION
  // ----------------------------------------------------------

  /**
   * Simulate a read-only contract call (e.g. get_engagement, ledgers_until_unlock).
   * Does not submit a transaction — no gas cost.
   */
  async simulateContractCall(method: string, args: xdr.ScVal[]): Promise<any> {
    try {
      const contract = new Contract(this.contractId);
      const dummyKeypair = Keypair.random();
      const dummyAccount = {
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(dummyAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const simulation = await this.rpcClient.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation error: ${simulation.error}`);
      }
      if (SorobanRpc.Api.isSimulationSuccess(simulation) && simulation.result) {
        return scValToNative(simulation.result.retval);
      }
      return null;
    } catch (error) {
      this.logger.error(`simulateContractCall(${method}) failed`, error.message);
      throw error;
    }
  }

  // ----------------------------------------------------------
  // LEDGER — CURRENT
  // ----------------------------------------------------------

  async getLatestLedger(): Promise<number> {
    const info = await this.rpcClient.getLatestLedger();
    return info.sequence;
  }

  // ----------------------------------------------------------
  // RETENTION TIMER UTILITIES
  // ----------------------------------------------------------

  /**
   * Estimate the wall-clock DateTime for a future ledger sequence.
   * Used when creating RetentionSchedule records so the cron job
   * knows when to fire without re-querying the chain.
   *
   * Formula: now + ((targetLedger - currentLedger) × 5s)
   *
   * @param targetLedger   — the ledger sequence we want the datetime for
   * @param currentLedger  — the current ledger sequence (from getLatestLedger)
   * @returns estimated Date object
   */
  ledgerToDateTime(targetLedger: number, currentLedger: number): Date {
    const SECONDS_PER_LEDGER = 5;
    const ledgersAway = targetLedger - currentLedger;
    const secondsAway = ledgersAway * SECONDS_PER_LEDGER;
    return new Date(Date.now() + secondsAway * 1000);
  }

  /**
   * Estimate how many days remain until a ledger unlocks.
   * Used for display in notifications and the dashboard countdown.
   */
  ledgersToDays(ledgerCount: number): number {
    return Math.ceil(ledgerCount / this.LEDGERS_PER_DAY);
  }

  /**
   * Check on-chain whether a Locked milestone is now unlockable.
   * Calls is_milestone_unlockable() on the contract.
   */
  async isMilestoneUnlockable(
    engagementId: string,
    milestoneIndex: number,
  ): Promise<boolean> {
    try {
      const { nativeToScVal } = await import('@stellar/stellar-sdk');
      const result = await this.simulateContractCall('is_milestone_unlockable', [
        nativeToScVal(engagementId, { type: 'string' }),
        nativeToScVal(milestoneIndex, { type: 'u32' }),
      ]);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  /**
   * Get the remaining ledgers until a milestone unlocks.
   * Calls ledgers_until_unlock() on the contract.
   */
  async ledgersUntilUnlock(
    engagementId: string,
    milestoneIndex: number,
  ): Promise<number> {
    try {
      const { nativeToScVal } = await import('@stellar/stellar-sdk');
      const result = await this.simulateContractCall('ledgers_until_unlock', [
        nativeToScVal(engagementId, { type: 'string' }),
        nativeToScVal(milestoneIndex, { type: 'u32' }),
      ]);
      return Number(result ?? 0);
    } catch {
      return 0;
    }
  }

  // ----------------------------------------------------------
  // ON-CHAIN TRANSACTION SUBMISSION
  // ----------------------------------------------------------

  /**
   * Build, simulate, assemble, sign, and submit a create_engagement tx.
   * The backend keypair is used to sign on behalf of the company.
   * Returns the tx hash and ledger the tx was included in.
   */
  async submitCreateEngagement(params: {
    engagementId: string;
    companyAddress: string;
    recruiterAddress: string;
    arbiterAddress: string;
    tokenAddress: string;
    totalAmount: string;
    milestones: Array<{ name: string; paymentPercent: number; kind: string; retentionDays?: number }>;
  }): Promise<{ txHash: string; ledger: number }> {
    if (!this.backendKeypair) {
      throw new BadRequestException('Backend Stellar keypair not configured');
    }

    const contract = new Contract(this.contractId);
    const account = await this.rpcClient.getAccount(this.backendKeypair.publicKey());

    const milestonesScVal = nativeToScVal(
      params.milestones.map((m) => ({
        name: m.name,
        payment_percent: m.paymentPercent,
        kind: m.kind,
        retention_days: m.retentionDays ?? null,
      })),
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'create_engagement',
          nativeToScVal(params.engagementId, { type: 'string' }),
          nativeToScVal(params.companyAddress, { type: 'address' }),
          nativeToScVal(params.recruiterAddress, { type: 'address' }),
          nativeToScVal(params.arbiterAddress, { type: 'address' }),
          nativeToScVal(params.tokenAddress, { type: 'address' }),
          nativeToScVal(BigInt(params.totalAmount), { type: 'i128' }),
          milestonesScVal,
        ),
      )
      .setTimeout(60)
      .build();

    const simulation = await this.rpcClient.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new BadRequestException(`Contract simulation failed: ${simulation.error}`);
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulation).build();
    prepared.sign(this.backendKeypair);

    const sendResult = await this.rpcClient.sendTransaction(prepared);
    if (sendResult.status === 'ERROR') {
      throw new BadRequestException(`Transaction submission failed: ${sendResult.errorResult}`);
    }

    // Poll for confirmation
    let getResult: SorobanRpc.Api.GetTransactionResponse;
    let attempts = 0;
    do {
      await new Promise((r) => setTimeout(r, 2000));
      getResult = await this.rpcClient.getTransaction(sendResult.hash);
      attempts++;
    } while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 15);

    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new BadRequestException(`Transaction not confirmed: ${getResult.status}`);
    }

    return { txHash: sendResult.hash, ledger: getResult.ledger };
  }

  // ----------------------------------------------------------
  // USDC UTILITIES
  // ----------------------------------------------------------

  /**
   * Check if a Stellar account has sufficient token balance.
   * Queries Horizon for trustline balance.
   */
  async checkTokenBalance(
    accountAddress: string,
    tokenAddress: string,
    requiredAmount: bigint,
  ): Promise<{ sufficient: boolean; balance: bigint }> {
    try {
      const horizonUrl = this.config.get<string>('STELLAR_HORIZON_URL');
      const response = await fetch(`${horizonUrl}/accounts/${accountAddress}`);
      if (!response.ok) {
        throw new Error(`Account not found: ${accountAddress}`);
      }
      const account = await response.json();
      const trustline = account.balances.find(
        (b: any) => b.asset_code && b.asset_issuer && 
          `${b.asset_code}:${b.asset_issuer}` === tokenAddress ||
          b.asset_type === 'native' && tokenAddress === 'native',
      );
      if (!trustline) {
        return { sufficient: false, balance: 0n };
      }
      const balance = this.usdcToStroops(trustline.balance);
      return { sufficient: balance >= requiredAmount, balance };
    } catch (error) {
      this.logger.error(`Failed to check balance for ${accountAddress}`, error.message);
      throw error;
    }
  }

  /** Convert stroops (i128 as string/bigint) to human-readable USDC */
  stroopsToUsdc(stroops: string | bigint, decimals = 2): string {
    const value = BigInt(stroops);
    const whole = value / 10_000_000n;
    const fraction = (value % 10_000_000n).toString().padStart(7, '0');
    return parseFloat(`${whole}.${fraction}`).toFixed(decimals);
  }

  /** Convert human-readable USDC amount to stroops */
  usdcToStroops(usdc: string): bigint {
    const [whole, fraction = ''] = usdc.split('.');
    const paddedFraction = fraction.padEnd(7, '0').slice(0, 7);
    return BigInt(whole) * 10_000_000n + BigInt(paddedFraction);
  }
}
