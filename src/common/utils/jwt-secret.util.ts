// Minimum length for a JWT_SECRET that is meant to represent 256 bits of
// entropy (e.g. `openssl rand -base64 32` produces 44 characters,
// `openssl rand -hex 32` produces 64). 32 is the floor below which a secret
// cannot possibly encode 256 random bits regardless of encoding.
const MIN_JWT_SECRET_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

const KNOWN_WEAK_SECRETS = new Set([
  'your-super-secret-jwt-key-change-in-production',
  'changeme',
  'change-me',
  'secret',
  'supersecret',
  'jwtsecret',
  'jwt_secret',
  'password',
]);

// Throws if JWT_SECRET is missing or too weak to plausibly carry 256 bits of
// entropy: too short, a known placeholder, or too few distinct characters
// (e.g. a repeated-character string padded out to pass a length check).
export function assertSecureJwtSecret(secret: string | undefined | null): void {
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Generate one with: openssl rand -base64 32',
    );
  }

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (256 bits of entropy). ` +
        'Generate one with: openssl rand -base64 32',
    );
  }

  if (KNOWN_WEAK_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'JWT_SECRET is a known placeholder/default value and must not be used. ' +
        'Generate a unique secret with: openssl rand -base64 32',
    );
  }

  if (new Set(secret).size < MIN_UNIQUE_CHARS) {
    throw new Error(
      'JWT_SECRET has too little character variety to be a securely random 256-bit value. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
}
