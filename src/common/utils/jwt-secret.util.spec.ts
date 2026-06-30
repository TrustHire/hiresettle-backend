import { assertSecureJwtSecret } from './jwt-secret.util';

describe('assertSecureJwtSecret', () => {
  it('throws when the secret is missing', () => {
    expect(() => assertSecureJwtSecret(undefined)).toThrow(/not set/);
    expect(() => assertSecureJwtSecret(null)).toThrow(/not set/);
    expect(() => assertSecureJwtSecret('')).toThrow(/not set/);
  });

  it('throws when the secret is shorter than 32 characters', () => {
    expect(() => assertSecureJwtSecret('short-secret')).toThrow(/at least 32 characters/);
  });

  it('throws for known placeholder/default values', () => {
    expect(() =>
      assertSecureJwtSecret('your-super-secret-jwt-key-change-in-production'),
    ).toThrow(/placeholder\/default/);
  });

  it('throws for low-variety strings padded to pass the length check', () => {
    expect(() => assertSecureJwtSecret('a'.repeat(40))).toThrow(/character variety/);
  });

  it('accepts a properly generated 256-bit secret', () => {
    // openssl rand -base64 32
    expect(() =>
      assertSecureJwtSecret('Kx7mP2qR9vL4nT8wZ1cB6yH3jF5sD0gA9eU2iO7xQ4k='),
    ).not.toThrow();
  });
});
