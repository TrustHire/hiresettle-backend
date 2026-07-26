# Secret Management & Credential Rotation

This document covers how HireSettle backend secrets are stored, validated,
and rotated across environments.

## Principles

- **No secrets in version control.** `.env` is gitignored. Only
  `.env.example` is committed, and it must contain placeholder values only
  — never a real key, password, or signing seed.
- **JWT_SECRET is entropy-checked at startup.** `src/main.ts` calls
  `assertSecureJwtSecret()` (`src/common/utils/jwt-secret.util.ts`) before
  the server starts accepting traffic (skipped only when `NODE_ENV` is
  `test` or `ci`). The process refuses to boot if `JWT_SECRET` is missing,
  shorter than 32 characters, a known placeholder/default value, or low in
  character variety. Generate a compliant value with:

  ```bash
  openssl rand -base64 32
  ```

- **Secrets are injected by the platform, not baked into images or repo
  config.** See [Production secrets injection](#production-secrets-injection)
  below.

## Secret inventory

| Secret | Used for | Rotation owner |
| --- | --- | --- |
| `JWT_SECRET` | Signs/verifies access & refresh tokens | Backend on-call |
| `SMTP_PASS` | Authenticates outbound email (Nodemailer) | Backend on-call |
| `STELLAR_SECRET_KEY` | Reads on-chain events from Horizon/RPC (read-only, holds no funds) | Backend on-call |
| `DATABASE_URL` (credential portion) | Postgres auth | Backend on-call |
| `S3_SECRET_ACCESS_KEY` | S3/object storage auth | Backend on-call |

## Rotation procedures

### JWT_SECRET

Rotating this secret invalidates every access token signed with the old
value and the refresh-token signature check, so plan for a short window of
forced re-logins.

1. Generate a new value: `openssl rand -base64 32`.
2. Set the new value in the target environment's secret store (see
   [Production secrets injection](#production-secrets-injection)).
3. Redeploy/restart the service so all instances pick up the new value at
   once — running old and new instances side by side with different
   `JWT_SECRET`s will cause spurious 401s on whichever instance didn't
   issue a given token.
4. Existing refresh tokens become invalid; users are signed out and must
   log in again. There is no overlap/grace period by design — `JwtModule`
   only ever holds one active secret.

### SMTP_PASS

1. Generate a new app password / API key in the SMTP provider's console
   (e.g. Gmail App Passwords, SendGrid API key).
2. Update `SMTP_PASS` in the environment's secret store.
3. Redeploy so `ConfigService` picks up the new value (it's read at
   startup, not per-request).
4. Revoke the old app password/key in the provider's console once the new
   deployment is confirmed sending mail.

### Stellar signing/reading keys (`STELLAR_SECRET_KEY`)

The configured key is read-only — it queries Horizon/Soroban RPC for chain
events and never signs a fund-moving transaction — but it is still a
credential that should be rotated if exposed.

1. Generate a new Stellar keypair (e.g. with the Stellar SDK or `stellar
   keys generate`).
2. Update `STELLAR_SECRET_KEY` in the environment's secret store.
3. Redeploy. The event indexer (`HorizonIndexerService`) re-establishes its
   connection using the new key on the next poll cycle — no on-chain action
   is required since the key is not associated with contract authorization.
4. If the old key was also used elsewhere (e.g. manual scripts), revoke or
   stop using it there too.

### AWS S3 credentials (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`)

`S3Service` (`src/common/s3/s3.service.ts`) reads these once via `ConfigService`
in its constructor to build the `S3Client` used for `uploadFile` and
`getPresignedUrl` — like the other secrets in this doc, a new value only
takes effect after a redeploy/restart, not live.

1. In AWS IAM (or the console for whatever provider `S3_ENDPOINT` points at,
   if set to a non-AWS S3-compatible service), create a new access key for
   the same IAM user/role. Do not deactivate the old key yet — AWS allows up
   to two active access keys per user, which is what makes step 5 possible.
2. Update `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in the environment's
   secret store (see [Production secrets injection](#production-secrets-injection)
   below).
3. Redeploy so `S3Service` picks up the new values at startup.
4. Confirm uploads and presigned URL generation both work against the new
   key — e.g. exercise the document upload/download flow end to end.
5. Wait out the longest `expiresIn` window used for presigned URLs issued
   before the cutover (`getPresignedUrl` defaults to `3600` seconds / 1
   hour) before deactivating and deleting the old access key in IAM.

**Downtime considerations**

- Because AWS permits two simultaneous active keys per user, this rotation
  can be zero-downtime — unlike `JWT_SECRET`, there's no window where every
  instance must flip at once.
- Presigned URLs are signed with whichever key was active at generation
  time. If the old key is deactivated before an already-issued presigned
  URL expires, that URL starts failing with `403 SignatureDoesNotMatch`.
  Rotating the key doesn't retroactively invalidate live URLs on its own —
  only revoking the old key too early does — so step 5's wait matters.
- If `S3_ENDPOINT` is set to a non-AWS S3-compatible provider (MinIO,
  DigitalOcean Spaces, Cloudflare R2, etc.), confirm it also supports two
  concurrent active keys before relying on the zero-downtime approach above
  — not all providers do.

### General rule

Never rotate by editing `.env` on a single running host and leaving others
on the old value — always rotate through the platform's secret store so
every instance restarts with the same new value.

## Production secrets injection

Secrets are injected as environment variables by the hosting platform.
None of them are committed to the repo, baked into the Docker image, or
stored in CI logs.

### Railway

- Set variables under **Project → Service → Variables**.
- Use **Shared Variables** at the project level for values reused across
  services (e.g. a shared `DATABASE_URL` host).
- Railway redeploys the service automatically when a variable changes,
  which gives you the "redeploy after rotation" step above for free.

### Fly.io

- Use `fly secrets set` rather than `[env]` in `fly.toml` (that file is
  committed and must never contain real values):

  ```bash
  fly secrets set JWT_SECRET="$(openssl rand -base64 32)" --app hiresettle-backend
  fly secrets set SMTP_PASS="..." STELLAR_SECRET_KEY="..." --app hiresettle-backend
  ```

- `fly secrets set` triggers a new release/rollout automatically, so the
  whole fleet restarts on the new value together.

### AWS ECS

- Store secrets in **AWS Secrets Manager** (or SSM Parameter Store) and
  reference them from the task definition's `secrets` block (not
  `environment`), e.g.:

  ```json
  "secrets": [
    { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:...:secret:hiresettle/jwt-secret" }
  ]
  ```

- Rotating the value in Secrets Manager does not automatically restart
  running tasks — force a new deployment (`aws ecs update-service
  --force-new-deployment`) so tasks are recycled and re-resolve the secret.
- Scope the task execution role's `secretsmanager:GetSecretValue` permission
  to only the specific secret ARNs the service needs.

## Dependency vulnerability scanning

Covered separately in [security.md](./security.md).