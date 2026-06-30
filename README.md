# HireSettle — Backend Repo

> **NestJS API for milestone-based recruiter fee escrow on Stellar**

This is **Repo 2 of 3** in the HireSettle project:

| Repo | Description |
|------|-------------|
| `hiresettle-contract` | Soroban smart contract (Rust) |
| `hiresettle-backend` ← you are here | NestJS REST API + event poller + retention scheduler |
| `hiresettle-frontend` | Next.js + Freighter wallet UI |

---

## What This Backend Does

- Stores off-chain engagement and milestone metadata in PostgreSQL
- Polls Stellar RPC every 5 seconds for contract events and updates local state
- **Retention scheduler** — sends "window approaching" notifications 3 days before unlock, and automatically detects when retention milestones are ready to confirm
- Sends in-app and email notifications to companies, recruiters, and arbiters
- Provides a clean REST API for the frontend
- Issues JWT tokens via Sign-In With Stellar (no passwords)
- Swagger docs at `/docs`

---

## What's Different From ChainSettle Backend

### `RetentionSchedulerService` — the key addition

This is the most HireSettle-specific service. It runs two independent cron jobs:

**Approaching notification (every hour)**
Reads the `RetentionSchedule` table for records where `notifyAt <= now` and `notified = false`. Sends a "retention window closes in 3 days" notification to both the company and recruiter. The `notifyAt` is set to `unlockAt - 3 days` when the engagement is created.

**Auto-unlock check (every 10 minutes)**
Reads the `RetentionSchedule` table for records where `unlockAt <= now` and `unlocked = false`. For each one, calls `is_milestone_unlockable()` on the Stellar RPC to confirm the ledger has actually passed. If yes, marks the milestone as `PENDING` in the DB and notifies the recruiter to submit proof.

The actual `unlock_milestone()` on-chain call is intentionally left to the frontend — this avoids the backend needing a funded Stellar account.

### `RetentionSchedule` table

A dedicated Prisma model that tracks when each retention milestone should unlock and whether it has been notified and unlocked. Created automatically when an engagement is registered in the DB.

### New API endpoints

- `GET /engagements/:id/milestones/:index/timer` — returns `{ daysRemaining, ledgersRemaining, unlockable, estimatedUnlockAt }` for the frontend countdown
- `POST /engagements/:id/sync` — force re-read from Stellar chain
- Milestone controller now nested under engagements: `/engagements/:engagementId/milestones`

### Updated Prisma schema

- `Milestone` now has `kind`, `retentionDays`, `validAfterLedger`, `unlockEstimatedAt` fields
- `Engagement` has `REPLACEMENT_REQUESTED` status
- New `RetentionSchedule` model
- New `MILESTONE_UNLOCKED`, `REPLACEMENT_REQUESTED`, `RETENTION_WINDOW_APPROACHING` notification types

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   NestJS Application                         │
│                                                             │
│  ┌──────────┐ ┌─────────────┐ ┌──────────┐ ┌───────────┐  │
│  │   Auth   │ │ Engagements │ │Milestones│ │  Events   │  │
│  │  Module  │ │   Module    │ │  Module  │ │  Module   │  │
│  └──────────┘ └─────────────┘ └──────────┘ └───────────┘  │
│                                               ↑      ↑     │
│                                     EventsService  RetentionSchedulerService  │
│                                     (5s poll)   (hourly + 10min cron)  │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │  PrismaService   │  │        StellarService             │ │
│  │  (PostgreSQL)    │  │  (RPC + retention timer utils)    │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

All endpoints prefixed with `/v1`. Protected routes require `Authorization: Bearer <JWT>`.

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/nonce?address=G...` | Get challenge nonce |
| `POST` | `/auth/login` | Submit signed nonce, receive JWT |

### Engagements
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/engagements` | ✓ | Register on-chain engagement |
| `GET` | `/engagements` | ✓ | List with filters (company, recruiter, status) |
| `GET` | `/engagements/:id` | ✓ | Full detail + milestones + events |
| `POST` | `/engagements/:id/sync` | ✓ | Force sync from Stellar |

### Milestones
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/engagements/:id/milestones` | ✓ | List milestones |
| `GET` | `/engagements/:id/milestones/:index` | ✓ | Single milestone |
| `GET` | `/engagements/:id/milestones/:index/timer` | ✓ | Retention countdown timer |

### Events, Notifications, Health — same as ChainSettle backend

---

## Project Structure

```
hiresettle-backend/
├── .env.example
├── .gitignore
├── nest-cli.json
├── package.json
├── tsconfig.json
├── README.md
│
├── prisma/
│   └── schema.prisma              ← User, Engagement, Milestone, RetentionSchedule, etc.
│
└── src/
    ├── main.ts
    ├── app.module.ts
    │
    ├── common/
    │   ├── prisma/                ← Global PrismaService
    │   ├── stellar/               ← Global StellarService (+ retention timer utils)
    │   ├── filters/               ← HttpExceptionFilter
    │   ├── interceptors/          ← TransformInterceptor
    │   ├── guards/                ← JwtAuthGuard
    │   ├── decorators/            ← @CurrentUser()
    │   └── utils/                 ← date.util.ts
    │
    └── modules/
        ├── auth/                  ← Sign-In With Stellar + JWT
        ├── engagements/           ← CRUD + retention schedule creation
        ├── milestones/            ← State updates + timer query
        ├── events/
        │   ├── events.service.ts             ← Stellar RPC poller (5s cron)
        │   ├── retention-scheduler.service.ts ← Retention cron jobs (hourly + 10min)
        │   └── events.controller.ts
        ├── notifications/         ← In-app + email (Nodemailer)
        └── health/                ← /health endpoint
```

---

## Quick Start (Docker Compose)

The fastest way to get a local environment running:

### Docker Compose (recommended)

```bash
cp .env.example .env
# Fill in required values in .env, then:
docker compose up
```

The `api` service runs `prisma migrate deploy` automatically before starting. Postgres data is persisted in a named volume.

API: `http://localhost:3000/api/v1`
Swagger: `http://localhost:3000/docs`

### Manual

```bash
cp .env.example .env
# Edit .env — fill in JWT_SECRET, STELLAR_* and SMTP_* at minimum

docker compose up -d        # starts PostgreSQL and (optionally) Redis
npm install
npx prisma migrate dev --name init
npx prisma generate
npm run start:dev
```

API: `http://localhost:3000/api/v1`
Swagger: `http://localhost:3000/docs`
Metrics: `http://localhost:3000/metrics`

> If you don't have Docker, start a local PostgreSQL instance and set `DATABASE_URL` manually.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | HTTP port the server listens on |
| `API_PREFIX` | No | `api/v1` | URL prefix for all API routes |
| `ALLOWED_ORIGINS` | No | `http://localhost:3001` | Comma-separated CORS origins |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWTs (min 32 chars in prod) |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token lifetime |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `STELLAR_NETWORK` | **Yes** | — | `testnet` or `mainnet` |
| `STELLAR_RPC_URL` | **Yes** | — | Soroban RPC endpoint |
| `STELLAR_HORIZON_URL` | **Yes** | — | Horizon REST endpoint |
| `HIRESETTLE_CONTRACT_ID` | **Yes** | — | Deployed Soroban contract address |
| `STELLAR_SECRET_KEY` | **Yes** | — | Read-only keypair for event polling |
| `ALLOWED_TOKENS` | **Yes** | — | JSON array of accepted token configs |
| `SMTP_HOST` | **Yes** | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | **Yes** | — | SMTP username |
| `SMTP_PASS` | **Yes** | — | SMTP password / app password |
| `EMAIL_FROM` | No | `noreply@hiresettle.com` | From address for outgoing email |
| `THROTTLE_TTL` | No | `60` | Rate limit window in seconds |
| `THROTTLE_LIMIT` | No | `100` | Max requests per window |
| `EVENT_POLLING_INTERVAL_MS` | No | `5000` | How often to poll for chain events |
| `LEDGERS_PER_DAY` | No | `17280` | Used for retention timer math |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | — | OpenTelemetry collector URL (unset = tracing disabled) |
| `OTEL_SERVICE_NAME` | No | `hiresettle-backend` | Service name in traces |
| `SENTRY_DSN` | No | — | Sentry error tracking DSN (unset = disabled) |
| `S3_ACCESS_KEY_ID` | **Yes** | — | AWS / S3-compatible access key |
| `S3_SECRET_ACCESS_KEY` | **Yes** | — | AWS / S3-compatible secret |
| `S3_REGION` | **Yes** | — | S3 region |
| `S3_BUCKET` | **Yes** | — | S3 bucket name |
| `S3_ENDPOINT` | No | AWS default | Custom endpoint for S3-compatible services |
| `REDIS_URL` | No | — | Redis URL; omit to use in-memory cache |
| `METRICS_ALLOWED_IPS` | No | `127.0.0.1,::1` | IPs allowed to scrape `/metrics` |

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start with hot-reload (development) |
| `npm run start:prod` | Start compiled output (production) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage report |
| `npm run lint` | Lint and auto-fix with ESLint |
| `npm run format` | Format with Prettier |
| `npm run release` | Bump version + update CHANGELOG (conventional commits) |

---

## Running Tests

```bash
npm run test           # all tests
npm run test:watch     # watch mode
npm run test:cov       # with coverage (thresholds: 70% lines/functions, 60% branches)
```

---

## Retention Timer Logic

When a new engagement is created, the backend calculates estimated wall-clock unlock times for each Retention milestone:

```typescript
const validAfterLedger = createdLedger + (retentionDays × 17_280);
const unlockEstimatedAt = ledgerToDateTime(validAfterLedger, currentLedger);
// unlockEstimatedAt = now + ((validAfterLedger - currentLedger) × 5s)
```

These estimates are stored in both the `Milestone` table and the `RetentionSchedule` table. The scheduler uses them to fire notifications and unlock checks at the right time without querying the chain on every tick.

The `GET /milestones/:index/timer` endpoint queries the chain directly to get the exact remaining ledgers:

```json
{
  "daysRemaining": 27,
  "ledgersRemaining": 466560,
  "unlockable": false,
  "estimatedUnlockAt": "2026-07-12T09:00:00.000Z"
}
```

---

## Production Checklist

- [ ] Replace in-memory nonce store with Redis
- [ ] Wire up `Keypair.verify()` in `auth.service.ts`
- [ ] Persist `lastProcessedLedger` in DB (not memory) — survives restarts
- [ ] Set strong `JWT_SECRET`
- [ ] Set `CORS_ORIGIN` to frontend production URL
- [ ] Use HTTPS behind nginx or Caddy
- [ ] Set up Prisma connection pooling (PgBouncer)

---

## License

MIT
