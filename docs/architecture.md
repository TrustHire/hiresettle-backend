# Architecture

## System Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        NestJS Application                          │
│                                                                    │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │   Auth   │  │ Engagements │  │ Milestones │  │   Events    │  │
│  │  Module  │  │   Module    │  │   Module   │  │   Module    │  │
│  └──────────┘  └─────────────┘  └────────────┘  └─────────────┘  │
│                                                   ↑          ↑     │
│                                        EventsService   RetentionSchedulerService
│                                        (5 s poll)      (hourly + 10 min cron)
│                                                                    │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐ │
│  │  PrismaService │  │ StellarService │  │  NotificationsService│ │
│  │  (PostgreSQL)  │  │ (RPC + Horizon)│  │  (email + SSE)       │ │
│  └────────────────┘  └────────────────┘  └──────────────────────┘ │
│                                                                    │
│  ┌──────────────┐  ┌───────────┐  ┌───────────┐  ┌────────────┐  │
│  │  AdminModule │  │  S3Module │  │CacheModule │  │HealthModule│  │
│  └──────────────┘  └───────────┘  └───────────┘  └────────────┘  │
└────────────────────────────────────────────────────────────────────┘
         │                          │                    │
   PostgreSQL                Stellar Testnet          AWS S3
   (Prisma ORM)              (Soroban RPC +         (file storage)
                              Horizon API)
```

## Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Sign-In With Stellar (challenge/response), JWT issuance and refresh |
| `EngagementsModule` | CRUD for off-chain engagement records; triggers retention schedule creation |
| `MilestonesModule` | Milestone state machine transitions (LOCKED → PENDING → PROOF_SUBMITTED → CONFIRMED/DISPUTED → RESOLVED); retention timer queries; dispute evidence upload |
| `EventsModule` | Polls Stellar RPC every 5 seconds for contract events; processes and dispatches them; retries failed events |
| `NotificationsModule` | Persists in-app notifications; sends emails via Nodemailer; manages SSE connections |
| `AdminModule` | User management, dead-letter event inspection and requeue, arbiter assignment, CSV report export |
| `BillingModule` | Fee configuration and billing record management |
| `RecruitersModule` | Recruiter profile queries |
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

**JWT via Stellar signature** — Authentication is Sign-In With Stellar: the frontend signs a server-issued nonce with the user's Freighter wallet, and the backend verifies the Ed25519 signature before issuing a JWT.
