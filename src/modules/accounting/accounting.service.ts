import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AccountingCategory,
  AccountingConnection,
  AccountingProvider,
  AccountingSyncStatus,
  MilestoneStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DistributedLockService } from '../../common/lock/distributed-lock.service';
import { decryptSecret, encryptSecret } from '../../common/crypto/secret-box';
import { AccountingClientFactory } from './accounting-providers';
import { ListSyncLogsQueryDto, UpsertAccountMappingDto } from './dto/accounting.dto';

const STATE_TOKEN_TYPE = 'accounting_oauth_state';
const MAX_ATTEMPTS = 5;
const ENQUEUE_BATCH = 500;
const PUSH_BATCH = 100;
/** Re-scan a little before the last run so milestones confirmed mid-run are not missed. */
const RESCAN_OVERLAP_MS = 60 * 60 * 1000;

/** Stroops (7 dp) → 2 dp decimal string, rounded half-up. */
export function stroopsToMoney(stroops: bigint): string {
  const cents = (stroops + 50_000n) / 100_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** ≤ 21 chars (QuickBooks DocNumber limit), stable per milestone+category. */
export function billReference(category: AccountingCategory, milestoneId: string): string {
  const tag = category === AccountingCategory.PLATFORM_FEE ? 'F' : 'R';
  return `HS${tag}-${createHash('sha256').update(milestoneId).digest('hex').slice(0, 16)}`;
}

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly clients: AccountingClientFactory,
    private readonly lock: DistributedLockService,
  ) {}

  // ---------------- OAuth connection flow ----------------

  async getConnectUrl(companyId: string, provider: AccountingProvider) {
    const state = await this.jwt.signAsync(
      { sub: companyId, provider, nonce: randomBytes(8).toString('hex'), type: STATE_TOKEN_TYPE },
      { expiresIn: '10m' },
    );
    return { authorizeUrl: this.clients.get(provider).authorizeUrl(state) };
  }

  /** Returns the frontend URL to redirect the browser to. Never throws. */
  async handleCallback(provider: AccountingProvider, query: Record<string, string>): Promise<string> {
    const frontend = this.config.get<string>('FRONTEND_URL', 'https://app.hiresettle.com').replace(/\/$/, '');
    const done = (status: 'connected' | 'error', reason?: string) =>
      `${frontend}/settings/integrations?accounting=${provider.toLowerCase()}&status=${status}` +
      (reason ? `&reason=${encodeURIComponent(reason)}` : '');

    if (query.error) return done('error', query.error);
    if (!query.code || !query.state) return done('error', 'missing_code');

    let companyId: string;
    try {
      const state = await this.jwt.verifyAsync(query.state);
      if (state.type !== STATE_TOKEN_TYPE || state.provider !== provider) return done('error', 'invalid_state');
      companyId = state.sub;
    } catch {
      return done('error', 'invalid_state');
    }

    try {
      const tokens = await this.clients.get(provider).exchangeCode(query.code, query);
      const data = {
        externalTenantId: tokens.tenantId,
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
        disconnectedAt: null,
      };
      await this.prisma.accountingConnection.upsert({
        where: { companyId_provider: { companyId, provider } },
        // Only milestones released after connecting are pushed, so history is not back-filled.
        create: { companyId, provider, syncFrom: new Date(), ...data },
        update: data,
      });
      return done('connected');
    } catch (err) {
      this.logger.warn(`${provider} connect failed for company ${companyId}: ${(err as Error).message}`);
      return done('error', 'exchange_failed');
    }
  }

  async listConnections(companyId: string) {
    const rows = await this.prisma.accountingConnection.findMany({ where: { companyId } });
    return rows.map((c) => ({
      provider: c.provider,
      connected: !c.disconnectedAt,
      externalTenantId: c.externalTenantId,
      syncFrom: c.syncFrom,
      lastSyncedAt: c.lastSyncedAt,
      connectedAt: c.createdAt,
    }));
  }

  async disconnect(companyId: string, provider: AccountingProvider) {
    const conn = await this.activeConnection(companyId, provider);
    // Tokens are overwritten so nothing usable is kept; logs are retained for audit.
    await this.prisma.accountingConnection.update({
      where: { id: conn.id },
      data: { disconnectedAt: new Date(), accessTokenEnc: encryptSecret(''), refreshTokenEnc: encryptSecret('') },
    });
    return { disconnected: true, provider };
  }

  // ---------------- Account mappings ----------------

  listMappings(companyId: string, provider: AccountingProvider) {
    return this.prisma.accountMapping.findMany({ where: { companyId, provider }, orderBy: { category: 'asc' } });
  }

  upsertMapping(companyId: string, provider: AccountingProvider, dto: UpsertAccountMappingDto) {
    const accountCode = dto.accountCode.trim();
    return this.prisma.accountMapping.upsert({
      where: { companyId_provider_category: { companyId, provider, category: dto.category } },
      create: { companyId, provider, category: dto.category, accountCode },
      update: { accountCode },
    });
  }

  async deleteMapping(companyId: string, provider: AccountingProvider, category: AccountingCategory) {
    const { count } = await this.prisma.accountMapping.deleteMany({ where: { companyId, provider, category } });
    if (!count) throw new NotFoundException(`No ${category} mapping for ${provider}`);
    return { deleted: true, category };
  }

  // ---------------- Sync log ----------------

  async listSyncLogs(companyId: string, q: ListSyncLogsQueryDto) {
    const limit = q.limit ?? 50;
    const rows = await this.prisma.accountingSyncLog.findMany({
      where: {
        connection: { companyId, ...(q.provider ? { provider: q.provider } : {}) },
        ...(q.status ? { status: q.status } : {}),
      },
      include: { connection: { select: { provider: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map(({ connection, connectionId: _c, ...log }) => ({
        ...log,
        provider: connection.provider,
        amount: stroopsToMoney(log.amount),
        amountStroops: log.amount.toString(),
        reference: billReference(log.category, log.milestoneId),
      })),
      meta: { limit, nextCursor: rows.length > limit ? page[page.length - 1].id : null },
    };
  }

  // ---------------- Sync ----------------

  async syncNow(companyId: string, provider: AccountingProvider) {
    const conn = await this.activeConnection(companyId, provider);
    const result = await this.syncConnection(conn);
    if (!result) throw new ConflictException('A sync for this connection is already running');
    return result;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncAll() {
    const connections = await this.prisma.accountingConnection.findMany({ where: { disconnectedAt: null } });
    for (const conn of connections) {
      try {
        await this.syncConnection(conn);
      } catch (err) {
        this.logger.error(`Accounting sync failed for connection ${conn.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Returns null when another worker holds the connection's lock. */
  async syncConnection(conn: AccountingConnection) {
    const lockKey = `accounting-sync:${conn.id}`;
    const token = await this.lock.tryAcquireLock(lockKey, 10 * 60_000);
    if (!token) return null;
    const runStartedAt = new Date();
    try {
      const enqueued = await this.enqueue(conn);
      const pushed = await this.push(conn);
      await this.prisma.accountingConnection.update({ where: { id: conn.id }, data: { lastSyncedAt: runStartedAt } });
      return { enqueued, ...pushed };
    } finally {
      await this.lock.releaseLock(lockKey, token);
    }
  }

  /** Records a PENDING log row for each released milestone (recruiter payment + platform fee). */
  private async enqueue(conn: AccountingConnection): Promise<number> {
    const company = await this.prisma.user.findUnique({
      where: { id: conn.companyId },
      select: { stellarAddress: true, plan: { select: { platformFeeBps: true } } },
    });
    if (!company) return 0;

    const ownership: Prisma.EngagementWhereInput[] = [{ companyId: conn.companyId }];
    if (company.stellarAddress) ownership.push({ companyAddress: company.stellarAddress });

    const since = conn.lastSyncedAt
      ? new Date(Math.max(conn.syncFrom.getTime(), conn.lastSyncedAt.getTime() - RESCAN_OVERLAP_MS))
      : conn.syncFrom;
    const feeBps = BigInt(company.plan?.platformFeeBps ?? 0);

    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const milestones = await this.prisma.milestone.findMany({
        where: {
          status: MilestoneStatus.CONFIRMED,
          confirmedAt: { gte: since },
          paymentReleased: { gt: 0 },
          engagement: { OR: ownership },
        },
        select: { id: true, paymentReleased: true },
        orderBy: { id: 'asc' },
        take: ENQUEUE_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!milestones.length) break;

      const rows: Prisma.AccountingSyncLogCreateManyInput[] = [];
      for (const m of milestones) {
        const released = m.paymentReleased ?? 0n;
        rows.push({ connectionId: conn.id, category: AccountingCategory.RECRUITER_FEE, milestoneId: m.id, amount: released });
        const fee = (released * feeBps) / 10_000n;
        if (fee > 0n) {
          rows.push({ connectionId: conn.id, category: AccountingCategory.PLATFORM_FEE, milestoneId: m.id, amount: fee });
        }
      }
      // The unique (connection, category, milestone) key makes re-scans no-ops.
      const { count } = await this.prisma.accountingSyncLog.createMany({ data: rows, skipDuplicates: true });
      total += count;
      cursor = milestones[milestones.length - 1].id;
      if (milestones.length < ENQUEUE_BATCH) break;
    }
    return total;
  }

  private async push(conn: AccountingConnection) {
    const logs = await this.prisma.accountingSyncLog.findMany({
      where: {
        connectionId: conn.id,
        OR: [{ status: AccountingSyncStatus.PENDING }, { status: AccountingSyncStatus.FAILED, attempts: { lt: MAX_ATTEMPTS } }],
      },
      orderBy: { createdAt: 'asc' },
      take: PUSH_BATCH,
    });
    if (!logs.length) return { pushed: 0, failed: 0 };

    let accessToken: string;
    try {
      accessToken = await this.accessToken(conn);
    } catch (err) {
      // Auth problems are connection-level — don't burn per-document attempts on them.
      this.logger.warn(`Could not refresh ${conn.provider} token for connection ${conn.id}: ${(err as Error).message}`);
      return { pushed: 0, failed: 0, error: 'token_refresh_failed' };
    }

    const mappings = await this.prisma.accountMapping.findMany({
      where: { companyId: conn.companyId, provider: conn.provider },
    });
    const accountFor = new Map(mappings.map((m) => [m.category, m.accountCode]));

    const milestones = await this.prisma.milestone.findMany({
      where: { id: { in: [...new Set(logs.map((l) => l.milestoneId))] } },
      select: {
        id: true,
        name: true,
        confirmedAt: true,
        engagement: {
          select: { id: true, jobTitle: true, recruiterAddress: true, recruiter: { select: { name: true, company: true } } },
        },
      },
    });
    const byId = new Map(milestones.map((m) => [m.id, m]));

    const client = this.clients.get(conn.provider);
    const currency = this.config.get<string>('ACCOUNTING_CURRENCY', 'USD');
    const platformVendor = this.config.get<string>('ACCOUNTING_PLATFORM_VENDOR_NAME', 'HireSettle');
    let pushed = 0;
    let failed = 0;

    for (const log of logs) {
      const milestone = byId.get(log.milestoneId);
      const accountCode = accountFor.get(log.category);
      let error: string | null = null;
      let externalId: string | null = null;

      if (!milestone) {
        error = 'Milestone no longer exists';
      } else if (!accountCode) {
        error = `No ${conn.provider} account code mapped for ${log.category}`;
      } else {
        const e = milestone.engagement;
        const isFee = log.category === AccountingCategory.PLATFORM_FEE;
        try {
          externalId = await client.pushBill(accessToken, conn.externalTenantId, {
            reference: billReference(log.category, log.milestoneId),
            vendorName: isFee
              ? platformVendor
              : e.recruiter?.company || e.recruiter?.name || `Recruiter ${e.recruiterAddress.slice(0, 8)}`,
            date: milestone.confirmedAt ?? log.createdAt,
            currency,
            lines: [
              {
                description: `${isFee ? 'Platform fee' : 'Recruiter fee'} — ${e.jobTitle} / ${milestone.name} (engagement ${e.id})`,
                amount: stroopsToMoney(log.amount),
                accountCode,
              },
            ],
          });
        } catch (err) {
          error = (err as Error).message.slice(0, 1000);
        }
      }

      await this.prisma.accountingSyncLog.update({
        where: { id: log.id },
        data: externalId
          ? { status: AccountingSyncStatus.SUCCESS, externalId, error: null, attempts: { increment: 1 } }
          : { status: AccountingSyncStatus.FAILED, error, attempts: { increment: 1 } },
      });
      if (externalId) pushed++;
      else failed++;
    }

    return { pushed, failed };
  }

  // ---------------- helpers ----------------

  private async accessToken(conn: AccountingConnection): Promise<string> {
    if (conn.accessTokenExpiresAt > new Date()) return decryptSecret(conn.accessTokenEnc);
    const tokens = await this.clients.get(conn.provider).refresh(decryptSecret(conn.refreshTokenEnc));
    // Both providers rotate refresh tokens — persist the new one before using the access token.
    await this.prisma.accountingConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
      },
    });
    return tokens.accessToken;
  }

  private async activeConnection(companyId: string, provider: AccountingProvider) {
    const conn = await this.prisma.accountingConnection.findUnique({
      where: { companyId_provider: { companyId, provider } },
    });
    if (!conn || conn.disconnectedAt) throw new NotFoundException(`${provider} is not connected`);
    return conn;
  }

  static parseProvider(raw: string): AccountingProvider {
    const p = raw?.toUpperCase();
    if (p === AccountingProvider.XERO || p === AccountingProvider.QUICKBOOKS) return p;
    throw new BadRequestException('provider must be "xero" or "quickbooks"');
  }
}
