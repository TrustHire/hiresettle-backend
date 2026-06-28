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

## Setup

```bash
cp .env.example .env
npm install
npx prisma migrate dev --name init
npx prisma generate
npm run start:dev
```

API: `http://localhost:3000/v1`
Swagger: `http://localhost:3000/docs`

---

## Running Tests

```bash
npm run test
npm run test:cov
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
