import { ConfigService } from '@nestjs/config';

/** A SEP-24 anchor the platform lets recruiters cash out through. */
export interface PayoutAnchorConfig {
  /** Stable identifier used in API requests and stored on Payout rows. */
  id: string;
  name: string;
  /** Domain hosting /.well-known/stellar.toml (no scheme). */
  homeDomain: string;
  /** Asset codes this anchor accepts for withdrawal, e.g. ["USDC"]. */
  assets: string[];
}

const DOMAIN_RE = /^[a-z0-9.-]+(:\d+)?$/i;

/**
 * Parses PAYOUT_ANCHORS (JSON array). Invalid entries are dropped rather than
 * crashing boot, so a typo in one anchor does not disable the others.
 */
export function loadPayoutAnchors(config: ConfigService): PayoutAnchorConfig[] {
  const raw = config.get<string>('PAYOUT_ANCHORS', '[]') || '[]';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (a: any) =>
        a && typeof a.id === 'string' && typeof a.homeDomain === 'string' && DOMAIN_RE.test(a.homeDomain),
    )
    .map((a: any) => ({
      id: a.id,
      name: typeof a.name === 'string' ? a.name : a.id,
      homeDomain: a.homeDomain.toLowerCase(),
      assets: Array.isArray(a.assets) && a.assets.length ? a.assets.map(String) : ['USDC'],
    }));
}
