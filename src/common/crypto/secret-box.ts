import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/**
 * AES-256-GCM encryption for third-party secrets we must be able to read back
 * (OAuth refresh tokens, webhook signing secrets). Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 *
 * Key: INTEGRATIONS_ENCRYPTION_KEY, falling back to JWT_SECRET so dev setups work.
 * Rotating the key invalidates stored secrets — integrations must reconnect.
 */
function key(): Buffer {
  const material = process.env.INTEGRATIONS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!material) throw new Error('INTEGRATIONS_ENCRYPTION_KEY (or JWT_SECRET) must be set');
  return createHash('sha256').update(material).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(box: string): string {
  const [v, iv, tag, enc] = box.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
}

/** One-way salted hash for secrets we only ever verify (OAuth client secrets). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Constant-time string comparison (e.g. hex HMAC digests). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
