import * as crypto from 'crypto';

/**
 * Computes the HMAC-SHA256 signature sent in the X-HireSettle-Signature
 * header. Must be computed over the exact raw body bytes the receiver will
 * verify against — see docs/webhooks.md.
 */
export function signWebhookBody(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export const WEBHOOK_SIGNATURE_HEADER = 'X-HireSettle-Signature';
