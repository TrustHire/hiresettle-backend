import { createHash, createHmac } from 'crypto';

/** prevHash of the first entry in every chain. */
export const GENESIS_HASH = '0'.repeat(64);

export type AuditChainTable = 'auditLog' | 'engagementAuditLog' | 'milestoneAuditLog';

/**
 * Chained tables and the columns covered by each entry's hash.
 * Every content column must be listed: anything not hashed can be edited undetected.
 */
export const AUDIT_CHAIN_TABLES: Record<AuditChainTable, readonly string[]> = {
  auditLog: ['id', 'entityType', 'entityId', 'action', 'oldValue', 'newValue', 'reason', 'changedBy', 'createdAt'],
  engagementAuditLog: ['id', 'engagementId', 'fromStatus', 'toStatus', 'changedBy', 'reason', 'createdAt'],
  milestoneAuditLog: ['id', 'milestoneId', 'fromStatus', 'toStatus', 'changedBy', 'action', 'details', 'createdAt'],
};

/** Deterministic JSON: sorted object keys, Dates as ISO strings, BigInt as strings, undefined → null. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * hash = H(prevHash || "|" || canonical(content)).
 * With a secret key the chain is an HMAC chain, so someone with only database
 * access cannot recompute valid hashes after editing a row.
 */
export function computeEntryHash(
  table: AuditChainTable,
  row: Record<string, unknown>,
  prevHash: string,
  secret?: string,
): string {
  const content: Record<string, unknown> = {};
  for (const field of AUDIT_CHAIN_TABLES[table]) content[field] = row[field];
  const payload = `${prevHash}|${table}|${canonicalJson(content)}`;
  return secret
    ? createHmac('sha256', secret).update(payload).digest('hex')
    : createHash('sha256').update(payload).digest('hex');
}

/** Root over all chain heads, anchored daily on Stellar. */
export function computeRootHash(heads: Record<string, { chainSeq: number; hash: string }>): string {
  const parts = Object.keys(heads)
    .sort()
    .map((t) => `${t}:${heads[t].chainSeq}:${heads[t].hash}`);
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
