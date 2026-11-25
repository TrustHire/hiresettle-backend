import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { DistributedLockService } from '../../common/lock/distributed-lock.service';
import {
  AUDIT_CHAIN_TABLES,
  AuditChainTable,
  computeEntryHash,
  computeRootHash,
  GENESIS_HASH,
} from './audit-chain.util';

const SEAL_BATCH = 500;
const VERIFY_BATCH = 1000;
const TABLES = Object.keys(AUDIT_CHAIN_TABLES) as AuditChainTable[];

export type BrokenLinkReason = 'SEQUENCE_GAP' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH' | 'ANCHOR_MISMATCH';

export interface BrokenLink {
  table: AuditChainTable;
  chainSeq: number;
  id: string | null;
  reason: BrokenLinkReason;
  expected?: string;
  actual?: string | null;
}

export interface ChainReport {
  table: AuditChainTable;
  valid: boolean;
  verifiedEntries: number;
  unsealedEntries: number;
  head: { chainSeq: number; hash: string } | null;
  firstBrokenLink: BrokenLink | null;
}

export interface VerificationReport {
  valid: boolean;
  checkedAt: Date;
  chains: ChainReport[];
  /** The earliest broken link across all chains, or null when every chain is intact. */
  firstBrokenLink: BrokenLink | null;
  latestAnchor: { day: Date; rootHash: string; txHash: string | null } | null;
}

/**
 * Tamper-evident audit logs.
 *
 * Writers insert audit rows as before. The seal job assigns each new row a
 * contiguous chainSeq and hash = H(prevHash | content), under a Postgres
 * advisory lock so there is exactly one chain per table. Sealing out of band
 * keeps audit writes cheap and safe inside callers' interactive transactions.
 *
 * Any later edit, delete or re-ordering of a sealed row breaks the chain;
 * truncating the tail is caught by the daily root hash anchored on Stellar.
 */
@Injectable()
export class AuditChainService {
  private readonly logger = new Logger(AuditChainService.name);
  private readonly secret?: string;
  private readonly anchorEnabled: boolean;
  private lastReport: VerificationReport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly lock: DistributedLockService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('AUDIT_CHAIN_HMAC_KEY') || undefined;
    const enabled = config.get('AUDIT_CHAIN_ANCHOR_ENABLED');
    this.anchorEnabled = enabled === true || enabled === 'true';
  }

  // ── Sealing ────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE, { name: 'audit-chain-seal' })
  async sealAllScheduled(): Promise<void> {
    await this.lock.withLock('cron:audit-chain-seal', 5 * 60 * 1000, () => this.sealAll());
  }

  async sealAll(): Promise<Record<AuditChainTable, number>> {
    const result = {} as Record<AuditChainTable, number>;
    for (const table of TABLES) {
      let total = 0;
      let sealed: number;
      do {
        sealed = await this.sealBatch(table);
        total += sealed;
      } while (sealed === SEAL_BATCH);
      result[table] = total;
    }
    return result;
  }

  private async sealBatch(table: AuditChainTable): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        // Serialises sealers across instances, even if the Redis lock fails open.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-chain:${table}`}))`;
        const delegate = (tx as any)[table];

        const head = await delegate.findFirst({
          where: { chainSeq: { not: null } },
          orderBy: { chainSeq: 'desc' },
          select: { chainSeq: true, hash: true },
        });
        const pending: Record<string, unknown>[] = await delegate.findMany({
          where: { chainSeq: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: SEAL_BATCH,
        });

        let seq: number = head?.chainSeq ?? 0;
        let prevHash: string = head?.hash ?? GENESIS_HASH;
        for (const row of pending) {
          seq += 1;
          const hash = computeEntryHash(table, row, prevHash, this.secret);
          await delegate.update({
            where: { id: row.id },
            data: { chainSeq: seq, prevHash, hash },
          });
          prevHash = hash;
        }
        return pending.length;
      },
      { timeout: 60_000 },
    );
  }

  // ── Verification ───────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'audit-chain-verify', timeZone: 'UTC' })
  async verifyScheduled(): Promise<void> {
    await this.lock.withLock('cron:audit-chain-verify', 60 * 60 * 1000, async () => {
      const report = await this.verify();
      if (!report.valid) {
        const b = report.firstBrokenLink!;
        this.logger.error(
          `AUDIT CHAIN BROKEN: ${b.table} at chainSeq ${b.chainSeq} (id ${b.id ?? 'missing'}): ${b.reason}`,
        );
      } else {
        this.logger.log('Audit chains verified: all intact');
      }
    });
  }

  getLastReport(): VerificationReport | null {
    return this.lastReport;
  }

  async verify(tables: AuditChainTable[] = TABLES): Promise<VerificationReport> {
    const anchor = await this.prisma.auditChainAnchor.findFirst({ orderBy: { day: 'desc' } });
    const anchoredHeads = (anchor?.heads ?? {}) as Record<string, { chainSeq: number; hash: string }>;

    const chains: ChainReport[] = [];
    for (const table of tables) {
      chains.push(await this.verifyTable(table, anchoredHeads[table]));
    }

    const broken = chains.filter((c) => c.firstBrokenLink).map((c) => c.firstBrokenLink!);
    const report: VerificationReport = {
      valid: broken.length === 0,
      checkedAt: new Date(),
      chains,
      firstBrokenLink: broken.sort((a, b) => a.chainSeq - b.chainSeq)[0] ?? null,
      latestAnchor: anchor ? { day: anchor.day, rootHash: anchor.rootHash, txHash: anchor.txHash } : null,
    };
    this.lastReport = report;
    return report;
  }

  private async verifyTable(
    table: AuditChainTable,
    anchoredHead?: { chainSeq: number; hash: string },
  ): Promise<ChainReport> {
    const delegate = (this.prisma as any)[table];
    const unsealedEntries: number = await delegate.count({ where: { chainSeq: null } });

    let expectedSeq = 1;
    let prevHash = GENESIS_HASH;
    let verified = 0;
    let head: { chainSeq: number; hash: string } | null = null;
    let broken: BrokenLink | null = null;
    let anchorSeen = false;

    outer: for (;;) {
      const rows: (Record<string, unknown> & { id: string; chainSeq: number; prevHash: string | null; hash: string | null })[] =
        await delegate.findMany({
          where: { chainSeq: { gte: expectedSeq } },
          orderBy: { chainSeq: 'asc' },
          take: VERIFY_BATCH,
        });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.chainSeq !== expectedSeq) {
          broken = { table, chainSeq: expectedSeq, id: null, reason: 'SEQUENCE_GAP', actual: String(row.chainSeq) };
          break outer;
        }
        if (row.prevHash !== prevHash) {
          broken = { table, chainSeq: row.chainSeq, id: row.id, reason: 'PREV_HASH_MISMATCH', expected: prevHash, actual: row.prevHash };
          break outer;
        }
        const recomputed = computeEntryHash(table, row, prevHash, this.secret);
        if (row.hash !== recomputed) {
          broken = { table, chainSeq: row.chainSeq, id: row.id, reason: 'HASH_MISMATCH', expected: recomputed, actual: row.hash };
          break outer;
        }
        if (anchoredHead && row.chainSeq === anchoredHead.chainSeq) {
          anchorSeen = true;
          if (row.hash !== anchoredHead.hash) {
            broken = { table, chainSeq: row.chainSeq, id: row.id, reason: 'ANCHOR_MISMATCH', expected: anchoredHead.hash, actual: row.hash };
            break outer;
          }
        }
        prevHash = row.hash;
        head = { chainSeq: row.chainSeq, hash: row.hash };
        expectedSeq += 1;
        verified += 1;
      }
    }

    // Chain is shorter than what was anchored: the tail was deleted and re-chained or truncated.
    if (!broken && anchoredHead && !anchorSeen && anchoredHead.chainSeq > 0) {
      broken = {
        table,
        chainSeq: anchoredHead.chainSeq,
        id: null,
        reason: 'ANCHOR_MISMATCH',
        expected: anchoredHead.hash,
        actual: null,
      };
    }

    return { table, valid: !broken, verifiedEntries: verified, unsealedEntries, head, firstBrokenLink: broken };
  }

  // ── Daily anchoring ────────────────────────────────────────────────

  @Cron('15 0 * * *', { name: 'audit-chain-anchor', timeZone: 'UTC' })
  async anchorScheduled(): Promise<void> {
    await this.lock.withLock('cron:audit-chain-anchor', 30 * 60 * 1000, async () => {
      try {
        await this.anchorDailyRoot();
      } catch (err) {
        this.logger.error(`Audit chain anchoring failed: ${(err as Error).message}`);
      }
    });
  }

  /** Seal pending rows, compute the root over all chain heads, store it and (optionally) publish it on Stellar. */
  async anchorDailyRoot(now = new Date()) {
    await this.sealAll();

    const heads: Record<string, { chainSeq: number; hash: string }> = {};
    for (const table of TABLES) {
      const head = await (this.prisma as any)[table].findFirst({
        where: { chainSeq: { not: null } },
        orderBy: { chainSeq: 'desc' },
        select: { chainSeq: true, hash: true },
      });
      heads[table] = head ?? { chainSeq: 0, hash: GENESIS_HASH };
    }
    const rootHash = computeRootHash(heads);
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const existing = await this.prisma.auditChainAnchor.findUnique({ where: { day } });
    if (existing?.txHash) return existing;

    let txHash: string | null = null;
    if (this.anchorEnabled) {
      txHash = await this.stellar.anchorHash('hs_audit_root', rootHash);
      this.logger.log(`Anchored audit root ${rootHash} on Stellar (tx ${txHash})`);
    }

    const data = { rootHash, heads: heads as unknown as Prisma.InputJsonValue, txHash };
    return this.prisma.auditChainAnchor.upsert({ where: { day }, create: { day, ...data }, update: data });
  }
}
