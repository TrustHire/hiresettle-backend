# Authentication

HireSettle supports several ways to sign in. All of them ultimately issue the
same pair of tokens (an **access token** and a **refresh token**) and share the
same refresh/logout lifecycle. This document explains each login method, the
endpoints involved, and how tokens are issued and rotated.

## Token model

- **Access token** — short-lived JWT sent as `Authorization: Bearer <token>` on
every authenticated request. It carries the user id and is not stored
server-side.
- **Refresh token** — long-lived, opaque token stored server-side (hashed) and
used only to mint new access tokens. It is rotated on every refresh.

| Endpoint | Purpose |
| -------- | ------- |
| `POST /auth/refresh` | Exchange a valid refresh token for a new access + refresh token pair |
| `POST /auth/logout` | Revoke the current refresh token (and its session) |

### Refresh lifecycle

1. The client sends its refresh token to `POST /auth/refresh`.
2. The server validates the token, revokes it, and returns a **new** access
   token and a **new** refresh token (rotation). Reusing an already-rotated
   refresh token invalidates the session.
3. When the user signs out, the client calls `POST /auth/logout` with the
   refresh token; the server revokes it so it can no longer be exchanged.

## Email / password

1. `POST /auth/register` — create an account (email + password).
2. `POST /auth/login` — exchange email + password for an access/refresh token pair.
3. `POST /auth/refresh` — rotate tokens as described above.
4. `POST /auth/logout` — revoke the session.

## Stellar wallet signatures

Login is proven by signing a server-issued challenge with the wallet's private key.

1. `GET /auth/nonce` — request a one-time nonce/challenge for the wallet address.
2. The client signs the nonce with the Stellar keypair.
3. `POST /auth/wallet-login` — submit the address + signature; the server verifies
   it against the nonce and returns an access/refresh token pair.
4. `POST /auth/refresh` / `POST /auth/logout` — same lifecycle as above.

## Google OAuth

1. `GET /auth/google` — redirect the user to Google's consent screen.
2. `GET /auth/google/callback` — Google redirects back with an authorization code;
   the server exchanges it for the user's profile and issues an access/refresh
   token pair.
3. `POST /auth/refresh` / `POST /auth/logout` — same lifecycle as above.

## WebAuthn passkeys

1. `POST /auth/webauthn/register/options` — get registration options (challenge).
2. `POST /auth/webauthn/register/verify` — submit the attestation to register the passkey.
3. `POST /auth/webauthn/login/options` — get an authentication challenge.
4. `POST /auth/webauthn/login/verify` — submit the assertion; on success the server
   returns an access/refresh token pair.
5. `POST /auth/refresh` / `POST /auth/logout` — same lifecycle as above.

## TOTP 2FA

TOTP is a second factor layered on top of a primary login (email/password,
wallet, OAuth, or passkey).

1. `POST /auth/2fa/setup` — generate a TOTP secret and provisioning URI/QR code.
2. `POST /auth/2fa/verify` — confirm a code to enable 2FA on the account.
3. On subsequent logins, the primary method returns a challenge instead of tokens;
   the client submits the current code to `POST /auth/2fa/validate` to receive the
   access/refresh token pair.
4. `POST /auth/refresh` / `POST /auth/logout` — same lifecycle as above.

## API keys

API keys are for programmatic/server-to-server access rather than interactive login.

1. `POST /auth/api-keys` — create a key (returned once; only a hash is stored).
2. `GET /auth/api-keys` — list the caller's keys.
3. `DELETE /auth/api-keys/:id` — revoke a key.

API keys are sent as `Authorization: Bearer <api-key>` and are validated per
request; they do not participate in the refresh-token rotation flow.
