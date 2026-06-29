import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
  Transaction,
} from "@stellar/stellar-sdk";
import { StellarError, StellarErrorCode } from "./stellar.error";
import { CacheService } from "../cache/cache.service";

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
interface TokenConfig {
  address: string;
  symbol: string;
  decimals: number;
}

@Injectable()
export class StellarService implements OnModuleInit {
  private readonly logger = new Logger(StellarService.name);

  private rpcClient: SorobanRpc.Server;
  private networkPassphrase: string;
  private contractId: string;
  private backendKeypair: Keypair;
  private allowedTokens: TokenConfig[];
  private readonly LEDGERS_PER_DAY = 17_280; // 86400s ÷ 5s per ledger

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit() {
    const rpcUrl = this.config.get<string>("STELLAR_RPC_URL");
    const networkName = this.config.get<string>("STELLAR_NETWORK", "testnet");

    this.rpcClient = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    this.contractId = this.config.get<string>("HIRESETTLE_CONTRACT_ID");
    this.networkPassphrase =
      networkName === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

    // Parse allowed tokens from config
    try {
      const allowedTokensJson = this.config.get<string>('ALLOWED_TOKENS', '[]');
      this.allowedTokens = JSON.parse(allowedTokensJson);
    } catch (e) {
      this.logger.error('Failed to parse ALLOWED_TOKENS from config', e);
      this.allowedTokens = [];
    }

    const secretKey = this.config.get<string>('STELLAR_SECRET_KEY');
    if (secretKey) {
      this.backendKeypair = Keypair.fromSecret(secretKey);
    }

    this.logger.log(`Stellar connected to ${networkName} (${rpcUrl})`);
    this.logger.log(`Contract: ${this.contractId}`);
    this.logger.log(`Allowed tokens: ${this.allowedTokens.map(t => `${t.symbol} (${t.address})`).join(', ')}`);
  }

  // ----------------------------------------------------------
  // RPC ACCESS
  // ----------------------------------------------------------

  getClient(): SorobanRpc.Server {
    return this.rpcClient;
  }
  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }
  getContractId(): string {
    return this.contractId;
  }

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
            type: "contract",
            contractIds: [this.contractId],
          },
        ],
        limit: 100,
      });
      return result.events ?? [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch events from ledger ${startLedger}`,
        error.message,
      );
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
        sequenceNumber: () => "0",
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
      this.logger.error(
        `simulateContractCall(${method}) failed`,
        error.message,
      );
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
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const result = await this.simulateContractCall(
        "is_milestone_unlockable",
        [
          nativeToScVal(engagementId, { type: "string" }),
          nativeToScVal(milestoneIndex, { type: "u32" }),
        ],
      );
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
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const result = await this.simulateContractCall("ledgers_until_unlock", [
        nativeToScVal(engagementId, { type: "string" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
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
    milestones: Array<{
      name: string;
      paymentPercent: number;
      kind: string;
      retentionDays?: number;
    }>;
  }): Promise<{ txHash: string; ledger: number }> {
    if (!this.backendKeypair) {
      throw new BadRequestException("Backend Stellar keypair not configured");
    }

    const contract = new Contract(this.contractId);
    const account = await this.rpcClient.getAccount(
      this.backendKeypair.publicKey(),
    );

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
          "create_engagement",
          nativeToScVal(params.engagementId, { type: "string" }),
          nativeToScVal(params.companyAddress, { type: "address" }),
          nativeToScVal(params.recruiterAddress, { type: "address" }),
          nativeToScVal(params.arbiterAddress, { type: "address" }),
          nativeToScVal(params.tokenAddress, { type: "address" }),
          nativeToScVal(BigInt(params.totalAmount), { type: "i128" }),
          milestonesScVal,
        ),
      )
      .setTimeout(60)
      .build();

    const simulation = await this.rpcClient.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new BadRequestException(
        `Contract simulation failed: ${simulation.error}`,
      );
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulation).build();
    prepared.sign(this.backendKeypair);

    const sendResult = await this.rpcClient.sendTransaction(prepared);
    if (sendResult.status === "ERROR") {
      throw new BadRequestException(
        `Transaction submission failed: ${sendResult.errorResult}`,
      );
    }

    // Poll for confirmation
    let getResult: SorobanRpc.Api.GetTransactionResponse;
    let attempts = 0;
    do {
      await new Promise((r) => setTimeout(r, 2000));
      getResult = await this.rpcClient.getTransaction(sendResult.hash);
      attempts++;
    } while (
      getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 15
    );

    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new BadRequestException(
        `Transaction not confirmed: ${getResult.status}`,
      );
    }

    return { txHash: sendResult.hash, ledger: getResult.ledger };
  }

  // ----------------------------------------------------------
  // TYPED CONTRACT HELPERS (#58)
  // ----------------------------------------------------------

  private static readonly TX_CONFIRM_TIMEOUT_MS = 30_000;
  private static readonly TX_POLL_INTERVAL_MS = 2_000;

  /**
   * Build, simulate, sign, submit, and wait for confirmation of a contract call.
   * Throws StellarError with a typed code on any failure.
   * @param signer - keypair to sign with; defaults to the backend keypair
   */
  private async submitAndConfirm(
    tx: Transaction,
    signer?: Keypair,
  ): Promise<{ txHash: string; ledger: number }> {
    const keypair = signer ?? this.backendKeypair;
    if (!keypair) {
      throw new StellarError(
        'Backend Stellar keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    const simulation = await this.rpcClient.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new StellarError(
        `Contract simulation failed: ${simulation.error}`,
        StellarErrorCode.SIMULATION_FAILED,
      );
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulation).build();
    prepared.sign(keypair);

    const sendResult = await this.rpcClient.sendTransaction(prepared);
    if (sendResult.status === 'ERROR') {
      throw new StellarError(
        `Transaction submission failed: ${sendResult.errorResult}`,
        StellarErrorCode.SUBMISSION_FAILED,
        sendResult.hash,
      );
    }

    const deadline = Date.now() + StellarService.TX_CONFIRM_TIMEOUT_MS;
    let getResult: SorobanRpc.Api.GetTransactionResponse;

    do {
      await new Promise((r) => setTimeout(r, StellarService.TX_POLL_INTERVAL_MS));
      getResult = await this.rpcClient.getTransaction(sendResult.hash);
      if (Date.now() > deadline && getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new StellarError(
          `Transaction not confirmed within 30 s (hash: ${sendResult.hash})`,
          StellarErrorCode.CONFIRMATION_TIMEOUT,
          sendResult.hash,
        );
      }
    } while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new StellarError(
        `Transaction failed on-chain: ${getResult.status}`,
        StellarErrorCode.TRANSACTION_FAILED,
        sendResult.hash,
      );
    }

    return { txHash: sendResult.hash, ledger: getResult.ledger };
  }

  /**
   * Build and submit an engagement creation transaction.
   * Returns tx hash on confirmation; throws StellarError on failure.
   */
  async createEngagement(params: {
    engagementId: string;
    companyAddress: string;
    recruiterAddress: string;
    arbiterAddress: string;
    tokenAddress: string;
    totalAmount: string;
    milestones: Array<{
      name: string;
      paymentPercent: number;
      kind: string;
      retentionDays?: number;
    }>;
    signer?: Keypair;
  }): Promise<string> {
    const keypair = params.signer ?? this.backendKeypair;
    if (!keypair) {
      throw new StellarError(
        'Backend Stellar keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    const contract = new Contract(this.contractId);
    let account: Awaited<ReturnType<SorobanRpc.Server['getAccount']>>;
    try {
      account = await this.rpcClient.getAccount(keypair.publicKey());
    } catch (err) {
      throw new StellarError(
        `Signer account not found: ${keypair.publicKey()}`,
        StellarErrorCode.ACCOUNT_NOT_FOUND,
        undefined,
        err,
      );
    }

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

    const { txHash } = await this.submitAndConfirm(tx, params.signer);
    return txHash;
  }

  /**
   * Submit a retention unlock transaction for a LOCKED milestone.
   * Returns tx hash on confirmation; throws StellarError on failure.
   */
  async unlockMilestone(
    engagementId: string,
    milestoneIndex: number,
    signer?: Keypair,
  ): Promise<string> {
    const keypair = signer ?? this.backendKeypair;
    if (!keypair) {
      throw new StellarError(
        'Backend Stellar keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    const contract = new Contract(this.contractId);
    const account = await this.rpcClient.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'unlock_retention_milestone',
          nativeToScVal(engagementId, { type: 'string' }),
          nativeToScVal(milestoneIndex, { type: 'u32' }),
        ),
      )
      .setTimeout(60)
      .build();

    const { txHash } = await this.submitAndConfirm(tx, signer);
    return txHash;
  }

  /** Alias used by MilestonesService for backward compatibility. */
  async unlockRetentionMilestone(
    engagementId: string,
    milestoneIndex: number,
    signer?: Keypair,
  ): Promise<string> {
    return this.unlockMilestone(engagementId, milestoneIndex, signer);
  }

  /**
   * Submit a payment release transaction for a PROOF_SUBMITTED milestone.
   * Returns tx hash on confirmation; throws StellarError on failure.
   */
  async releaseMilestonePayment(
    engagementId: string,
    milestoneIndex: number,
    signer?: Keypair,
  ): Promise<string> {
    const keypair = signer ?? this.backendKeypair;
    if (!keypair) {
      throw new StellarError(
        'Backend Stellar keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    const contract = new Contract(this.contractId);
    const account = await this.rpcClient.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'release_milestone_payment',
          nativeToScVal(engagementId, { type: 'string' }),
          nativeToScVal(milestoneIndex, { type: 'u32' }),
        ),
      )
      .setTimeout(60)
      .build();

    const { txHash } = await this.submitAndConfirm(tx, signer);
    return txHash;
  }

  /**
   * Submit a cancellation transaction for an ACTIVE engagement.
   * Returns tx hash on confirmation; throws StellarError on failure.
   */
  async cancelEngagement(
    engagementId: string,
    signer?: Keypair,
  ): Promise<string> {
    const keypair = signer ?? this.backendKeypair;
    if (!keypair) {
      throw new StellarError(
        'Backend Stellar keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    const contract = new Contract(this.contractId);
    const account = await this.rpcClient.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'cancel_engagement',
          nativeToScVal(engagementId, { type: 'string' }),
        ),
      )
      .setTimeout(60)
      .build();

    const { txHash } = await this.submitAndConfirm(tx, signer);
    return txHash;
  }

  /**
   * Submit a dispute resolution transaction.
   * @param approved true → release payment; false → refund company
   */
  async resolveMilestoneDispute(
    engagementId: string,
    milestoneIndex: number,
    approved: boolean,
    signer?: Keypair,
  ): Promise<string> {
    const keypair = signer ?? this.backendKeypair;
    if (!keypair) {
      throw new StellarError(
        'Backend Stellar keypair is not configured',
        StellarErrorCode.KEYPAIR_NOT_CONFIGURED,
      );
    }

    const contract = new Contract(this.contractId);
    const account = await this.rpcClient.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'resolve_dispute',
          nativeToScVal(engagementId, { type: 'string' }),
          nativeToScVal(milestoneIndex, { type: 'u32' }),
          nativeToScVal(approved, { type: 'bool' }),
        ),
      )
      .setTimeout(60)
      .build();

    const { txHash } = await this.submitAndConfirm(tx, signer);
    return txHash;
  }

  /** Alias for getLatestLedger used by MilestonesService. */
  async getCurrentLedgerSequence(): Promise<number> {
    return this.getLatestLedger();
  }

  // ----------------------------------------------------------
  // TOKEN UTILITIES
  // ----------------------------------------------------------

  /** Get list of allowed tokens with metadata */
  getAllowedTokens(): TokenConfig[] {
    return this.allowedTokens;
  }

  /** Check if a token address is in the allowlist */
  isTokenAllowed(tokenAddress: string): boolean {
    return this.allowedTokens.some(t => t.address === tokenAddress);
  }

  /** Get token config by address, throws if not allowed */
  getTokenConfig(tokenAddress: string): TokenConfig {
    const config = this.allowedTokens.find(t => t.address === tokenAddress);
    if (!config) {
      throw new BadRequestException(`Token ${tokenAddress} is not allowed`);
    }
    return config;
  }

  /**
   * Check if a Stellar account has sufficient token balance.
   * Queries Horizon for trustline balance.
   */
  async checkTokenBalance(
    accountAddress: string,
    tokenAddress: string,
    requiredAmount: bigint,
  ): Promise<{ sufficient: boolean; balance: bigint }> {
    const { balance } = await this.getBalance(accountAddress, tokenAddress);
    return { sufficient: balance >= requiredAmount, balance };
  }

  /**
   * Get the token balance for a Stellar account.
   * Queries Horizon for trustline balance.
   */
  async getBalance(
    accountAddress: string,
    tokenAddress: string,
  ): Promise<{ balance: bigint }> {
    try {
      const tokenConfig = this.getTokenConfig(tokenAddress);
      const horizonUrl = this.config.get<string>('STELLAR_HORIZON_URL');
      const response = await fetch(`${horizonUrl}/accounts/${accountAddress}`);
      if (!response.ok) {
        // For balance endpoint and validations we want a hard failure.
        throw new BadRequestException(
          `Stellar account not found or not accessible: ${accountAddress}`,
        );
      }

      const account = await response.json();

      const isNative = tokenAddress === "native" || tokenAddress === "XLM";
      if (isNative) {
        // Horizon accounts endpoint returns native balance as XLM string.
        // For consistency with the existing usdcToStroops logic, we convert XLM stroops-like decimal into stroops.
        // NOTE: existing code treats balances as USDC->stroops; for native we assume Horizon returns stroops-compatible integer string.
        // If Horizon returns XLM as string (7 decimals), usdcToStroops still works.
        const nativeBalStr =
          account.balances?.find((b: any) => b.asset_type === "native")
            ?.balance ??
          account.balance ??
          "0";
        return { balance: this.usdcToStroops(String(nativeBalStr)) };
      }

      const trustline = account.balances.find(
        (b: any) =>
          b.asset_code &&
          b.asset_issuer &&
          `${b.asset_code}:${b.asset_issuer}` === tokenAddress,
      );
      if (!trustline) return { balance: 0n };

      // Horizon trustline balance for issued assets is a string representing the human unit for that asset.
      const balance = this.usdcToStroops(trustline.balance);
      return { balance };
    } catch (error: any) {
      this.logger.error(
        `Failed to get balance for ${accountAddress}`,
        error?.message,
      );
      throw error;
    }
  }

  /** Convert stroops (i128 as string/bigint) to human-readable amount */
  stroopsToHuman(stroops: string | bigint, tokenAddress: string, decimalsOverride?: number): string {
    const config = decimalsOverride ? { decimals: decimalsOverride } : this.getTokenConfig(tokenAddress);
    const value = BigInt(stroops);
    const divisor = BigInt(10) ** BigInt(config.decimals);
    const whole = value / divisor;
    const fraction = (value % divisor).toString().padStart(config.decimals, '0');
    return parseFloat(`${whole}.${fraction}`).toFixed(config.decimals);
  }

  /** Convert human-readable amount to stroops */
  humanToStroops(human: string, tokenOrDecimals: string | number): bigint {
    let decimals: number;
    if (typeof tokenOrDecimals === 'string') {
      const config = this.getTokenConfig(tokenOrDecimals);
      decimals = config.decimals;
    } else {
      decimals = tokenOrDecimals;
    }
    const [whole, fraction = ''] = human.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    const divisor = BigInt(10) ** BigInt(decimals);
    return BigInt(whole) * divisor + BigInt(paddedFraction);
  }

  /** Convert stroops (i128 as string/bigint) to human-readable USDC (backward compatibility) */
  stroopsToUsdc(stroops: string | bigint, decimals = 2): string {
    const divisor = BigInt(10) ** BigInt(7);
    const value = BigInt(stroops);
    const whole = value / divisor;
    const fraction = (value % divisor).toString().padStart(7, '0');
    return parseFloat(`${whole}.${fraction}`).toFixed(decimals);
  }

  /** Convert human-readable USDC amount to stroops (backward compatibility) */
  usdcToStroops(usdc: string): bigint {
    const [whole, fraction = ""] = usdc.split(".");
    const paddedFraction = fraction.padEnd(7, "0").slice(0, 7);
    return BigInt(whole) * 10_000_000n + BigInt(paddedFraction);
  }

  /**
   * Get the current base fee and recommended Soroban fee.
   * @returns { baseFee: number, sorobanFee: number }
   */
  /**
   * Check if a Stellar account exists and (optionally) has any balance.
   * Used by registration and interaction validations.
   *
   * @param requireFunded when true, the account must have non-zero balance on Horizon.
   */
  async accountExists(
    accountAddress: string,
    requireFunded = true,
  ): Promise<boolean> {
    try {
      const horizonUrl = this.config.get<string>("STELLAR_HORIZON_URL");
      const response = await fetch(`${horizonUrl}/accounts/${accountAddress}`);
      if (!response.ok) return false;
      if (!requireFunded) return true;

      const account = await response.json();
      // Horizon for native balance is returned under account.balance (stroops integer as string) on newer versions.
      const nativeBalance = account.balance ?? "0";
      const hasNative = BigInt(nativeBalance) > 0n;
      if (hasNative) return true;

      const balances = account.balances ?? [];
      return balances.some((b: any) => BigInt(b.balance ?? "0") > 0n);
    } catch (error) {
      return false;
    }
  }

  /** Validate Stellar address format (not on-chain existence). */
  isValidStellarAddress(address: string): boolean {
    try {
      return Keypair.fromPublicKey(address).publicKey() === address;
    } catch {
      return false;
    }
  }

  /**
   * Get the current base fee and recommended Soroban fee.
   * @returns { baseFee: number, sorobanFee: number } in stroops
   */
  async getFeeEstimate(): Promise<{ baseFee: number; sorobanFee: number }> {
    const CACHE_KEY = 'stellar:fee_estimate';
    const cached = await this.cache.get<{ baseFee: number; sorobanFee: number }>(CACHE_KEY);
    if (cached) return cached;

    const info = await this.rpcClient.getLatestLedger();
    const baseFee = Number(info.baseFee);
    const sorobanFee = baseFee * 10;
    const result = { baseFee, sorobanFee };
    await this.cache.set(CACHE_KEY, result, 10); // 10 s TTL
    return result;
  }
}
