import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutAnchorConfig } from './payout-anchors.config';

const TOML_CACHE_TTL_MS = 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 15_000;

export interface AnchorToml {
  webAuthEndpoint: string;
  transferServerSep24: string;
}

/** Subset of the SEP-24 transaction object we persist. */
export interface Sep24Transaction {
  id: string;
  kind?: string;
  status: string;
  more_info_url?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
}

export class AnchorHttpError extends BadGatewayException {
  constructor(public readonly anchorStatus: number, message: string) {
    super(message);
  }
}

/**
 * Thin HTTP client for SEP-1 (stellar.toml), SEP-10 (web auth) and
 * SEP-24 (interactive withdrawal) against a configured anchor.
 */
@Injectable()
export class Sep24ClientService {
  private readonly logger = new Logger(Sep24ClientService.name);
  private readonly tomlCache = new Map<string, { value: AnchorToml; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  async resolveToml(anchor: PayoutAnchorConfig): Promise<AnchorToml> {
    const cached = this.tomlCache.get(anchor.homeDomain);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const url = `${this.scheme()}://${anchor.homeDomain}/.well-known/stellar.toml`;
    const text = await (await this.request(url, { method: 'GET' })).text();
    const toml = parseTomlTopLevel(text);

    if (!toml.WEB_AUTH_ENDPOINT || !toml.TRANSFER_SERVER_SEP0024) {
      throw new BadGatewayException(
        `Anchor ${anchor.id} stellar.toml is missing WEB_AUTH_ENDPOINT or TRANSFER_SERVER_SEP0024`,
      );
    }

    const value: AnchorToml = {
      webAuthEndpoint: stripTrailingSlash(toml.WEB_AUTH_ENDPOINT),
      transferServerSep24: stripTrailingSlash(toml.TRANSFER_SERVER_SEP0024),
    };
    this.tomlCache.set(anchor.homeDomain, { value, expiresAt: Date.now() + TOML_CACHE_TTL_MS });
    return value;
  }

  /** SEP-10 step 1: fetch a challenge transaction for `account` to sign in the recruiter's wallet. */
  async getChallenge(
    anchor: PayoutAnchorConfig,
    account: string,
  ): Promise<{ transaction: string; networkPassphrase?: string }> {
    const { webAuthEndpoint } = await this.resolveToml(anchor);
    const url = new URL(webAuthEndpoint);
    url.searchParams.set('account', account);
    url.searchParams.set('home_domain', anchor.homeDomain);
    const body = await (await this.request(url.toString(), { method: 'GET' })).json();
    if (!body?.transaction) {
      throw new BadGatewayException(`Anchor ${anchor.id} returned no SEP-10 challenge`);
    }
    return { transaction: body.transaction, networkPassphrase: body.network_passphrase };
  }

  /** SEP-10 step 2: exchange the recruiter-signed challenge for an anchor JWT. */
  async exchangeChallenge(anchor: PayoutAnchorConfig, signedTransaction: string): Promise<string> {
    const { webAuthEndpoint } = await this.resolveToml(anchor);
    const body = await (
      await this.request(webAuthEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedTransaction }),
      })
    ).json();
    if (!body?.token) {
      throw new BadGatewayException(`Anchor ${anchor.id} did not issue a SEP-10 token`);
    }
    return body.token;
  }

  /** SEP-24: start an interactive withdrawal. Returns the anchor's URL and transaction id. */
  async startWithdrawal(
    anchor: PayoutAnchorConfig,
    token: string,
    params: { assetCode: string; account: string; amount?: string; lang?: string },
  ): Promise<{ id: string; url: string }> {
    const { transferServerSep24 } = await this.resolveToml(anchor);
    const payload: Record<string, string> = { asset_code: params.assetCode, account: params.account };
    if (params.amount) payload.amount = params.amount;
    if (params.lang) payload.lang = params.lang;

    const body = await (
      await this.request(`${transferServerSep24}/transactions/withdraw/interactive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
    ).json();

    if (body?.type !== 'interactive_customer_info_needed' || !body.url || !body.id) {
      throw new BadGatewayException(`Anchor ${anchor.id} returned an unexpected withdraw response`);
    }
    return { id: body.id, url: body.url };
  }

  /** SEP-24: fetch the current state of a transaction. */
  async getTransaction(anchor: PayoutAnchorConfig, token: string, id: string): Promise<Sep24Transaction> {
    const { transferServerSep24 } = await this.resolveToml(anchor);
    const url = new URL(`${transferServerSep24}/transaction`);
    url.searchParams.set('id', id);
    const body = await (
      await this.request(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
    ).json();
    if (!body?.transaction?.status) {
      throw new BadGatewayException(`Anchor ${anchor.id} returned no transaction for ${id}`);
    }
    return body.transaction;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (err) {
      this.logger.warn(`Anchor request failed: ${init.method} ${url} — ${(err as Error).message}`);
      throw new BadGatewayException('Anchor is unreachable');
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error ?? '';
      } catch {
        /* non-JSON error body */
      }
      throw new AnchorHttpError(res.status, `Anchor responded ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return res;
  }

  /** Anchors must use HTTPS; plain HTTP is only allowed outside production for local test anchors. */
  private scheme(): 'http' | 'https' {
    return this.config.get('NODE_ENV') !== 'production' && this.config.get('PAYOUT_ANCHORS_ALLOW_HTTP') === 'true'
      ? 'http'
      : 'https';
  }
}

/** Minimal parser for top-level `KEY = "value"` pairs in a stellar.toml. */
export function parseTomlTopLevel(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) break; // top-level keys end at the first table
    const match = /^([A-Z0-9_]+)\s*=\s*"([^"]*)"/.exec(line);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
