# Architecture

## System Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           NestJS Application                                 │
│                                                                              │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  ┌─────────────┐            │
│  │   Auth   │  │ Engagements │  │ Milestones │  │   Events    │            │
│  │  Module  │──│   Module    │──│   Module   │──│   Module    │            │
│  └────┬─────┘  └──────┬──────┘  └─────┬──────┘  └──────┬──────┘            │
│       │               │               │                │                     │
│       │               │               │     EventsService (5 s poll)         │
│       │               │               │     RetentionSchedulerService        │
│       │               ▼               │                                      │
│       │        ┌──────────────┐       │                                      │
│       │        │ Engagement   │       │                                      │
│       │        │ Templates    │───────┘                                      │
│       │        │ Module       │  (templates → engagements create)            │
│       │        └──────────────┘                                              │
│       │                                                                      │
│       │        ┌──────────────┐                                              │
│       └───────▶│   Billing    │  (company fee / billing summaries)           │
│                │   Module     │                                              │
│                └──────────────┘                                              │
│                                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐           │
│  │  PrismaService │  │ StellarService │  │  NotificationsService│           │
│  │  (PostgreSQL)  │  │ (RPC + Horizon)│  │  (email + SSE)       │           │
│  └────────────────┘  └────────────────┘  └──────────────────────┘           │
│                                                                              │
│  ┌──────────────┐  ┌───────────┐  ┌───────────┐  ┌────────────┐            │
│  │  AdminModule │  │  S3Module │  │CacheModule │  │HealthModule│            │
│  └──────────────┘  └───────────┘  └───────────┘  └────────────┘            │
└──────────────────────────────────────────────────────────────────────────────┘
         │                          │                    │
   PostgreSQL                Stellar Testnet          AWS S3
   (Prisma ORM)              (Soroban RPC +         (file storage)
                              Horizon API)
```

### Module dependency notes (Billing & Engagement Templates)

- **EngagementTemplatesModule** depends on Prisma (via global `PrismaModule`) and `IdempotencyModule`. Templates are company-scoped and feed into engagement creation in `EngagementsModule`.
- **BillingModule** depends on Prisma. It reads company engagements/milestones to produce billing summaries and CSV exports under `companies/me/billing*`.

## Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Email/password login, Google OAuth2, JWT issuance/refresh, API key creation helpers, 2FA |
| `EngagementsModule` | CRUD for off-chain engagement records; triggers retention schedule creation; accepts JWT or `X-Api-Key` |
| `EngagementTemplatesModule` | CRUD for reusable engagement templates (COMPANY only). Owns template + version records, company-scoped authorization, clone/update flows, and pre-configured milestone settings, compensation, and job metadata used when creating engagements quickly |
| `MilestonesModule` | Milestone state machine transitions (LOCKED → PENDING → PROOF_SUBMITTED → CONFIRMED/DISPUTED → RESOLVED); retention timer queries; dispute evidence upload |
| `EventsModule` | Polls Stellar RPC every 5 seconds for contract events; processes and dispatches them; retries failed events |
| `NotificationsModule` | Persists in-app notifications; sends emails via Nodemailer; manages SSE connections |
| `AdminModule` | User management, dead-letter event inspection and requeue, arbiter assignment, CSV report export, API key create/revoke, GDPR deletion queue |
| `BillingModule` | Owns company billing summaries and CSV export. Aggregates fee/escrow amounts from engagements for the authenticated COMPANY user over an optional date range (`GET /companies/me/billing`, `GET /companies/me/billing/export.csv`) |
| `RecruitersModule` | Recruiter profile queries |
| `UsersModule` | Public profile lookups by Stellar address (cached); authenticated user profile CRUD; GDPR erasure and JSON data export; notification preference management; avatar upload to S3 with MIME/size validation |
| `WebhooksModule` | Outbound webhook delivery for engagement lifecycle events; subscription CRUD (JWT or `X-Api-Key`); BullMQ queue-based async dispatch with inline fallback delivery; 5-second HTTP timeout |
| `HealthModule` | `GET /health` terminus check (database liveness) |
| `common/StellarModule` | Shared Stellar RPC/Horizon client, contract call helpers, retention timer math |
| `common/PrismaModule` | Global Prisma ORM client with optional metrics middleware |
| `common/S3Module` | S3 file upload and presigned URL generation |
| `common/CacheModule` | In-memory (or Redis-backed) cache-aside layer |

## Data Flow: Request to On-Chain Event

```
Frontend                 Backend                         Stellar Network
   │                        │                                   │
   │── POST /engagements ──►│                                   │
   │                        │── prisma.engagement.create() ───► │
   │                        │── scheduleRetention() ──────────► │
   │◄── 201 engagement ─────│                                   │
   │                        │                                   │
   │                        │  [every 5 seconds]                │
   │                        │◄── EventsService.pollEvents() ────│
   │                        │    (Stellar RPC getEvents)        │
   │                        │                                   │
   │                        │── process event ────────────────► │
   │                        │── update Milestone status         │
   │                        │── notify parties (email + SSE)    │
   │                        │                                   │
   │── GET /milestones ─────►│                                   │
   │◄── milestone state ────│                                   │
   │                        │                                   │
   │── POST /milestones/:i/evidence ►│                          │
   │                        │── validate MIME type              │
   │                        │── upload to S3                    │
   │◄── presigned URL ──────│                                   │
```

## Key Design Decisions

**Off-chain / on-chain split** — The backend stores engagement and milestone metadata in PostgreSQL but treats the Stellar contract as the source of truth. State transitions are driven by on-chain events polled by `EventsService`; the backend never writes state without a corresponding chain event (except admin overrides).

**Retention timer estimation** — Rather than querying the chain on every tick, the backend pre-calculates estimated unlock timestamps (`unlockAt`) when an engagement is created and stores them in `RetentionSchedule`. The scheduler uses these estimates to fire notifications and unlock checks without hammering the RPC.

**No funded backend account** — The backend intentionally holds no funds. `unlock_milestone()` is called from the frontend (via Freighter wallet). The backend calls `is_milestone_unlockable()` to confirm the ledger has passed, then marks the milestone `PENDING` so the recruiter knows to submit proof.

**Authentication** — Primary interactive auth is email/password (plus optional Google OAuth2), issuing access/refresh JWT pairs. Server-to-server callers may use hashed `X-Api-Key` credentials on selected routes (engagements, webhook subscriptions) as an alternative to a user JWT.
