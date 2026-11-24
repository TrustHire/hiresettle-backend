import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountingProvider } from '@prisma/client';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface BillLine {
  description: string;
  /** Decimal string with 2 dp, e.g. "1250.00" */
  amount: string;
  accountCode: string;
}

export interface BillInput {
  /** Stable reference, used as the bill number so re-pushes are recognisable in the ledger. */
  reference: string;
  vendorName: string;
  date: Date;
  currency: string;
  lines: BillLine[];
}

export interface AccountingClient {
  authorizeUrl(state: string): string;
  /** `query` is the full callback query (QuickBooks passes realmId there). */
  exchangeCode(code: string, query: Record<string, string>): Promise<TokenSet & { tenantId: string }>;
  refresh(refreshToken: string): Promise<TokenSet>;
  pushBill(accessToken: string, tenantId: string, bill: BillInput): Promise<string>;
}

export class AccountingApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

async function readJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new AccountingApiError(`${what} failed (${res.status}): ${text.slice(0, 500)}`, res.status);
  return text ? JSON.parse(text) : {};
}

function tokenSet(json: any): TokenSet {
  if (!json.access_token || !json.refresh_token) throw new AccountingApiError('Token response missing tokens');
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Refresh a minute early to avoid racing the expiry.
    expiresAt: new Date(Date.now() + (Number(json.expires_in ?? 1800) - 60) * 1000),
  };
}

abstract class OAuth2Client {
  protected abstract readonly tokenUrl: string;

  constructor(
    protected readonly clientId: string,
    protected readonly clientSecret: string,
    protected readonly redirectUri: string,
  ) {}

  protected async tokenRequest(params: Record<string, string>) {
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params),
    });
    return readJson(res, 'Token request');
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    return tokenSet(await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
  }
}

// ------------------------------------------------------------------ Xero

class XeroClient extends OAuth2Client implements AccountingClient {
  protected readonly tokenUrl = 'https://identity.xero.com/connect/token';

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid offline_access accounting.transactions accounting.contacts accounting.settings.read',
      state,
    });
    return `https://login.xero.com/identity/connect/authorize?${params}`;
  }

  async exchangeCode(code: string) {
    const tokens = tokenSet(
      await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri }),
    );
    // A Xero login can authorise several organisations; use the most recently connected one.
    const connections = await readJson(
      await fetch('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${tokens.accessToken}` } }),
      'Xero connections lookup',
    );
    const org = (connections as any[]).filter((c) => c.tenantType === 'ORGANISATION').pop();
    if (!org) throw new AccountingApiError('No Xero organisation was authorised');
    return { ...tokens, tenantId: org.tenantId };
  }

  async pushBill(accessToken: string, tenantId: string, bill: BillInput): Promise<string> {
    const date = bill.date.toISOString().slice(0, 10);
    const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-tenant-id': tenantId,
        // Xero de-duplicates retried requests with the same key.
        'Idempotency-Key': bill.reference,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        Invoices: [
          {
            Type: 'ACCPAY', // a bill
            Contact: { Name: bill.vendorName }, // matched by name, created if missing
            InvoiceNumber: bill.reference,
            Reference: bill.reference,
            Date: date,
            DueDate: date, // already settled on-chain
            CurrencyCode: bill.currency,
            Status: 'AUTHORISED',
            LineAmountTypes: 'NoTax',
            LineItems: bill.lines.map((l) => ({
              Description: l.description,
              Quantity: 1,
              UnitAmount: l.amount,
              AccountCode: l.accountCode,
            })),
          },
        ],
      }),
    });
    const json = await readJson(res, 'Xero bill push');
    const id = json?.Invoices?.[0]?.InvoiceID;
    if (!id) throw new AccountingApiError('Xero did not return an InvoiceID');
    return id;
  }
}

// ------------------------------------------------------------ QuickBooks

class QuickBooksClient extends OAuth2Client implements AccountingClient {
  protected readonly tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

  constructor(clientId: string, clientSecret: string, redirectUri: string, private readonly apiBase: string) {
    super(clientId, clientSecret, redirectUri);
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state,
    });
    return `https://appcenter.intuit.com/connect/oauth2?${params}`;
  }

  async exchangeCode(code: string, query: Record<string, string>) {
    const realmId = query.realmId;
    if (!realmId) throw new AccountingApiError('QuickBooks callback missing realmId');
    const tokens = tokenSet(
      await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri }),
    );
    return { ...tokens, tenantId: realmId };
  }

  private async api(accessToken: string, realmId: string, path: string, init: RequestInit = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${this.apiBase}/v3/company/${realmId}/${path}${sep}minorversion=70`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return readJson(res, `QuickBooks ${path.split('?')[0]}`);
  }

  private async query(accessToken: string, realmId: string, q: string) {
    return this.api(accessToken, realmId, `query?query=${encodeURIComponent(q)}`);
  }

  private escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  private async vendorId(accessToken: string, realmId: string, name: string): Promise<string> {
    const found = await this.query(accessToken, realmId, `select Id from Vendor where DisplayName = '${this.escape(name)}'`);
    const existing = found?.QueryResponse?.Vendor?.[0]?.Id;
    if (existing) return existing;
    const created = await this.api(accessToken, realmId, 'vendor', {
      method: 'POST',
      body: JSON.stringify({ DisplayName: name }),
    });
    return created.Vendor.Id;
  }

  /** Company mappings store the account number (AcctNum); QuickBooks references accounts by Id. */
  private async accountId(accessToken: string, realmId: string, code: string): Promise<string> {
    const found = await this.query(
      accessToken,
      realmId,
      `select Id from Account where AcctNum = '${this.escape(code)}'`,
    );
    const id = found?.QueryResponse?.Account?.[0]?.Id;
    if (id) return id;
    // Allow mapping by Id directly for companies that don't use account numbers.
    if (/^\d+$/.test(code)) return code;
    throw new AccountingApiError(`QuickBooks account with number "${code}" not found`);
  }

  async pushBill(accessToken: string, realmId: string, bill: BillInput): Promise<string> {
    // QuickBooks has no idempotency header; skip if a bill with this number already exists.
    const existing = await this.query(
      accessToken,
      realmId,
      `select Id from Bill where DocNumber = '${this.escape(bill.reference)}'`,
    );
    const existingId = existing?.QueryResponse?.Bill?.[0]?.Id;
    if (existingId) return existingId;

    const vendorId = await this.vendorId(accessToken, realmId, bill.vendorName);
    const lines = await Promise.all(
      bill.lines.map(async (l) => ({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: Number(l.amount),
        Description: l.description,
        AccountBasedExpenseLineDetail: { AccountRef: { value: await this.accountId(accessToken, realmId, l.accountCode) } },
      })),
    );
    const date = bill.date.toISOString().slice(0, 10);
    const created = await this.api(accessToken, realmId, 'bill', {
      method: 'POST',
      body: JSON.stringify({
        VendorRef: { value: vendorId },
        DocNumber: bill.reference, // ≤ 21 chars, guaranteed by the caller
        TxnDate: date,
        DueDate: date,
        CurrencyRef: { value: bill.currency },
        Line: lines,
      }),
    });
    return created.Bill.Id;
  }
}

@Injectable()
export class AccountingClientFactory {
  private readonly logger = new Logger(AccountingClientFactory.name);

  constructor(private readonly config: ConfigService) {}

  get(provider: AccountingProvider): AccountingClient {
    const callbackBase = (this.config.get<string>('PUBLIC_API_URL') ?? '').replace(/\/$/, '');
    const prefix = this.config.get<string>('API_PREFIX', 'api/v1').replace(/^\/|\/$/g, '');
    const redirectUri = `${callbackBase}/${prefix}/accounting/oauth/${provider.toLowerCase()}/callback`;

    if (provider === AccountingProvider.XERO) {
      const id = this.config.get<string>('XERO_CLIENT_ID');
      const secret = this.config.get<string>('XERO_CLIENT_SECRET');
      if (!id || !secret) throw new BadRequestException('Xero integration is not configured');
      return new XeroClient(id, secret, redirectUri);
    }

    const id = this.config.get<string>('QUICKBOOKS_CLIENT_ID');
    const secret = this.config.get<string>('QUICKBOOKS_CLIENT_SECRET');
    if (!id || !secret) throw new BadRequestException('QuickBooks integration is not configured');
    const sandbox = this.config.get<string>('QUICKBOOKS_ENVIRONMENT', 'production') === 'sandbox';
    return new QuickBooksClient(
      id,
      secret,
      redirectUri,
      sandbox ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com',
    );
  }
}
