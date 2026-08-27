# Environment Variables

Complete reference for every environment variable consumed by the HireSettle backend.

## Reading this document

- **Validated at startup** — the variable is validated by the Joi schema in
  `src/config/env.validation.ts` during `ConfigModule.forRoot()`. The
  process will refuse to start if a validated variable is missing or
  invalid (e.g., wrong enum value, too short).
- **Entropy-checked at startup** — in addition to Joi validation,
  `JWT_SECRET` is further checked for strength by
  `assertSecureJwtSecret()` (`src/common/utils/jwt-secret.util.ts`)
  before the server accepts traffic. The process refuses to boot if the
  secret is missing, shorter than 32 characters, a known placeholder, or
  low in character variety. This check is skipped when `NODE_ENV` is
  `test` or `ci`.
- Variables marked as "Required*" are required for a specific subsystem
  (e.g., S3 uploads, email delivery) but the application may start
  without them if that subsystem is not exercised.

---

## Application

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | No | Runtime environment: `development`, `production`, `test`, or `ci`. Controls logger format (JSON in production, colorized in dev), disables Swagger in production, and skips `JWT_SECRET` entropy check in `test`/`ci`. |
| `PORT` | No | `3000` | **Yes** | HTTP port the server listens on. Must be a valid port number. |
| `API_PREFIX` | No | `api/v1` | No | URL prefix for all API routes. The `/health`, `/docs`, `/docs-json`, and `/metrics` endpoints are excluded from this prefix. |
| `ALLOWED_ORIGINS` | No | `http://localhost:3001` | No | Comma-separated list of CORS origins. Requests from origins not in this list will be rejected by the CORS validator in `main.ts`. |
| `LOG_LEVEL` | No | `log` | **Yes** | Winston log level. Must be one of: `error`, `warn`, `log`, `debug`, `verbose`. `log` maps to Winston's `info` level internally. |

---

## Database

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | — | **Yes** | PostgreSQL connection string used by Prisma ORM. Example: `postgresql://user:pass@host:5432/dbname`. |
| `DATABASE_POOL_MIN` | No | `2` | **Yes** | Minimum number of connections in the Prisma connection pool. Must be between 1 and 20. |
| `DATABASE_POOL_MAX` | No | `10` | **Yes** | Maximum number of connections in the Prisma connection pool. Must be between 2 and 50. |

---

## Authentication (JWT)

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | **Yes** | — | **Yes** + entropy check | Secret key for signing and verifying access and refresh JWTs. Must be at least 32 characters. Generate with `openssl rand -base64 32`. See [docs/secrets.md](./secrets.md) for rotation procedures. |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | No | Access token lifetime (e.g., `15m`, `1h`, `30m`). Accepted by the `expiresIn` option of `JwtService.sign()`. |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | No | Refresh token JWT lifetime (e.g., `7d`, `30d`). Used for the `expiresIn` parameter when signing refresh tokens. |
| `JWT_REFRESH_EXPIRES_DAYS` | No | `7` | No | Refresh token database record expiration in days. Controls when the `RefreshToken.expiresAt` date is set. |
| `SKIP_ACCOUNT_VALIDATION` | No | `false` | No | When truthy (`true` / `1`), skips the Stellar account existence check during registration. Useful for testing against a local Stellar network without pre-funded accounts. |
| `HIRESETTLE_CONTRACT_VERSION` | No | `1` | No | Expected return value of the Soroban contract `version()` method. Startup fails if the configured contract reports a different version. |
| `SKIP_CONTRACT_COMPATIBILITY_CHECK` | No | `false` | No | Skips the Soroban contract version check. Use only when running against a local mock contract. |

---

## Stellar / Soroban

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `STELLAR_NETWORK` | **Yes** | — | **Yes** | Stellar network to connect to. Must be `testnet`, `mainnet`, or `futurenet`. Determines default RPC and Horizon URLs. |
| `STELLAR_RPC_URL` | No | Per‑network default | No | Soroban RPC endpoint. Defaults to `https://soroban-testnet.stellar.org` for testnet, `https://soroban-mainnet.stellar.org` for mainnet. Must be set explicitly for `futurenet`. |
| `STELLAR_HORIZON_URL` | No | Per‑network default | No | Horizon REST API endpoint. Defaults to `https://horizon-testnet.stellar.org` for testnet, `https://horizon.stellar.org` for mainnet. Must be set explicitly for `futurenet`. |
| `SOROBAN_CONTRACT_ADDRESS` | **Yes** | — | **Yes** | Primary Soroban contract address to monitor for events. |
| `HIRESETTLE_CONTRACT_ID` | No | — | No | Legacy / alternative contract address. Only used as a fallback when `SOROBAN_CONTRACT_ADDRESS` is not set. Prefer `SOROBAN_CONTRACT_ADDRESS`. |
| `STELLAR_SECRET_KEY` | **Yes** | — | No | Read-only Stellar secret key used by `StellarService` to query chain events and call contract functions. This key holds no funds — the backend never signs fund-moving transactions. See [docs/secrets.md](./secrets.md) for rotation. |
| `ALLOWED_TOKENS` | No | `[]` | No | JSON array of token configurations accepted by the platform. Example: `[{"code":"USDC","issuer":"G...","decimals":7}]`. Parsed in `StellarService` constructor. |
| `STELLAR_BALANCE_ALERT_INTERVAL_MS` | No | `300000` | **Yes** | Interval in milliseconds between checks of the configured Stellar account's native XLM balance. Must be at least 60000. |
| `STELLAR_BALANCE_ALERT_THRESHOLD_STROOPS` | No | `10000000` | **Yes** | Native XLM balance below which active administrators receive an alert. |

---

## SMTP / Email

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `SMTP_HOST` | **Yes** | — | **Yes** | SMTP server hostname for outbound transactional email. |
| `SMTP_PORT` | No | `587` | No | SMTP server port. Default 587 (STARTTLS). Set to `465` for implicit TLS. |
| `SMTP_USER` | **Yes** | — | **Yes** | SMTP authentication username. |
| `SMTP_PASS` | **Yes** | — | **Yes** | SMTP authentication password or app-specific password. See [docs/secrets.md](./secrets.md) for rotation. |
| `EMAIL_FROM` | No | `noreply@hiresettle.com` | No | `From` address for all outgoing emails sent by `NotificationsService`. |

---

## S3 / Object Storage

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `S3_ACCESS_KEY_ID` | Required* | — | No | AWS / S3-compatible access key ID. Required for file uploads (milestone evidence, avatars). See [docs/secrets.md](./secrets.md) for rotation. |
| `S3_SECRET_ACCESS_KEY` | Required* | — | No | AWS / S3-compatible secret access key. See [docs/secrets.md](./secrets.md) for rotation. |
| `S3_REGION` | Required* | — | No | S3 region (e.g., `us-east-1`, `eu-west-1`). Passed directly to the `S3Client` constructor. |
| `S3_BUCKET` | Required* | — | No | S3 bucket name for file storage. |
| `S3_ENDPOINT` | No | AWS default | No | Custom S3-compatible endpoint URL. Set for MinIO, DigitalOcean Spaces, Cloudflare R2, etc. When omitted, the AWS SDK defaults to the standard S3 endpoint for the configured region. |
| `S3_CDN_URL` | No | `$S3_ENDPOINT` | No | CDN base URL prepended to uploaded file keys. When set, avatar URLs use this instead of `S3_ENDPOINT`. Example: `https://cdn.example.com`. See `UsersService.uploadAvatar()`. |

---

## Rate Limiting

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `THROTTLE_TTL` | No | `60` | No | Rate limit window in seconds. After this many seconds the request count resets for a given client. |
| `THROTTLE_LIMIT` | No | `100` | No | Maximum number of requests allowed per client within the TTL window. The `/health` endpoint is excluded from throttling. |

---

## Redis & Queues

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `REDIS_URL` | No | `redis://localhost:6379` (BullMQ only) | No | Redis connection URL. Used by BullMQ for job queues (email, stellar-tx, webhook) and by `CacheService` for distributed caching. When omitted, `CacheService` falls back to an in-memory `Map` store; Bull Board and queues will use the default localhost URL. |

---

## Observability

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | — | No | OpenTelemetry collector endpoint URL. When set, the Node SDK starts and exports traces via OTLP over HTTP. When absent, tracing is disabled entirely. Example: `http://localhost:4318`. |
| `OTEL_SERVICE_NAME` | No | `hiresettle-backend` | No | Service name reported in OpenTelemetry traces (the `service.name` resource attribute). |
| `SENTRY_DSN` | No | — | No | Sentry DSN for error tracking. When set and `NODE_ENV` is not `test`/`ci`, Sentry is initialised with `tracesSampleRate: 1.0` and request/error handlers are mounted. See [docs/security.md](./security.md). |
| `METRICS_ALLOWED_IPS` | No | `127.0.0.1,::1` | No | Comma-separated list of IP addresses allowed to scrape the `/metrics` endpoint. When empty, the endpoint is open to all IPs. Uses `x-forwarded-for` header when present. |

---

## Notifications

| Variable | Required | Default | Validated at startup | Description |
| --- | --- | --- | --- | --- |
| `NOTIFICATION_RETENTION_DAYS` | No | `90` | **Yes** | Number of days to retain read notifications before the daily cleanup job deletes them. Must be at least 1. |

---

## Secrets inventory

The following variables contain credentials and must never be committed
to version control or logged. Rotation procedures are documented in
[docs/secrets.md](./secrets.md).

| Secret | Used for |
| --- | --- |
| `JWT_SECRET` | Signs/verifies access & refresh tokens |
| `SMTP_PASS` | Authenticates outbound email (Nodemailer) |
| `STELLAR_SECRET_KEY` | Reads on-chain events from Horizon/RPC (read-only, holds no funds) |
| `DATABASE_URL` (credential portion) | PostgreSQL authentication |
| `S3_SECRET_ACCESS_KEY` | S3 / object storage authentication |

---

## Production deployment

At deploy time the process must receive secrets and required configuration via
the hosting platform's secret store. See [docs/deployment.md](./deployment.md)
for the deploy sequence and [docs/secrets.md](./secrets.md) for how to inject
secrets on Railway, Fly.io, and AWS ECS.

---

## Related docs

- [Secret management & rotation](./secrets.md)
- [Production deployment](./deployment.md)
- [Architecture](./architecture.md)
- [Caching](./caching.md)
- [Notifications guide](./notifications-guide.md)
