import { createHmac } from 'crypto';
import { AtsProvider } from '@prisma/client';
import { safeEqual } from '../../common/crypto/secret-box';

export interface NormalizedAtsEvent {
  eventType: string;
  isHire: boolean;
  externalJobId?: string;
  externalCandidateId?: string;
}

const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));

/**
 * Greenhouse: `Signature: sha256 <hex>` where <hex> = HMAC-SHA256(rawBody, secretKey).
 * Lever:      body carries { token, triggeredAt, signature } where
 *             signature = HMAC-SHA256(token + triggeredAt, signatureToken).
 */
export function verifyAtsSignature(
  provider: AtsProvider,
  secret: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  body: any,
): boolean {
  if (provider === AtsProvider.GREENHOUSE) {
    const header = headers['signature'];
    const value = Array.isArray(header) ? header[0] : header;
    const match = value?.trim().match(/^sha256\s+([a-f0-9]{64})$/i);
    return !!match && safeEqual(match[1].toLowerCase(), hmacHex(secret, rawBody));
  }

  // LEVER
  const { token, triggeredAt, signature } = body ?? {};
  if (typeof token !== 'string' || triggeredAt === undefined || typeof signature !== 'string') return false;
  return safeEqual(signature.toLowerCase(), hmacHex(secret, `${token}${triggeredAt}`));
}

export function normalizeAtsEvent(provider: AtsProvider, body: any): NormalizedAtsEvent {
  if (provider === AtsProvider.GREENHOUSE) {
    const action = String(body?.action ?? 'unknown');
    const application = body?.payload?.application;
    return {
      eventType: action,
      isHire: action === 'hire_candidate',
      externalCandidateId: str(application?.candidate?.id ?? body?.payload?.candidate?.id),
      externalJobId: str(application?.jobs?.[0]?.id ?? body?.payload?.job?.id),
    };
  }

  // LEVER — candidateHired carries the opportunity (formerly "candidate") id; no posting id.
  const event = String(body?.event ?? 'unknown');
  return {
    eventType: event,
    isHire: event === 'candidateHired',
    externalCandidateId: str(body?.data?.opportunityId ?? body?.data?.candidateId),
    externalJobId: str(body?.data?.postingId),
  };
}
