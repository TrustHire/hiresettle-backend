# Notifications Guide

How HireSettle delivers notifications across channels, the available notification types, and how users can control their preferences.

## Delivery Channels

Every notification is written to the database as an **in-app** record. Depending on type and user preferences, the same event may also be delivered via **email** and pushed over **SSE**.

| Channel | Description |
|---------|-------------|
| **In-app** | Persisted in the `notifications` table. Always delivered regardless of preferences. Queried via `GET /notifications`. |
| **SSE** | Real-time push to `GET /notifications/stream`. Delivered whenever the user has an open connection; no persistence of missed messages. |
| **Email** | Sent via Nodemailer through a BullMQ queue (`email` queue, 3 retries with exponential backoff). Controlled by per-type user preferences (enabled by default). |
| **Slack** | Posted to a company's Slack channel via an incoming webhook (`slack` queue, 3 retries). Opt-in per user via `slackWebhookUrl`; only key, company-facing notification types are posted. |

---

## Notification Types

| Type | Trigger | Channels | Email Template |
|------|---------|----------|----------------|
| `ENGAGEMENT_CREATED` | Company creates an engagement; Stellar chain event | In-app, SSE, Email | `ENGAGEMENT_CREATED.html` |
| `MILESTONE_UNLOCKED` | Retention timer expires (cron every 10 min) or chain event | In-app, SSE, Email | — |
| `PROOF_SUBMITTED` | Recruiter submits proof for a milestone | In-app, SSE, Email | — |
| `MILESTONE_CONFIRMED` | Admin overrides milestone status to CONFIRMED | In-app, SSE, Email | `MILESTONE_CONFIRMED.html` |
| `PAYMENT_RELEASED` | Escrowed funds released to recruiter on-chain | In-app, SSE, Email | `PAYMENT_RELEASED.html` |
| `DISPUTE_RAISED` | Company disputes a milestone | In-app, SSE, Email | `DISPUTE_RAISED.html` |
| `DISPUTE_RESOLVED` | Arbiter resolves a dispute on-chain | In-app, SSE, Email | `DISPUTE_RESOLVED.html` |
| `REPLACEMENT_REQUESTED` | Company requests a candidate replacement | In-app, SSE, Email | `REPLACEMENT_REQUESTED.html` |
| `ENGAGEMENT_CANCELLED` | Company cancels an engagement; admin override | In-app, SSE, Email | `ENGAGEMENT_CANCELLED.html` |
| `RETENTION_WINDOW_APPROACHING` | Cron runs hourly; retention unlock is within 3 days | In-app, SSE, Email | `RETENTION_WINDOW_APPROACHING.html` |
| `ARBITER_ASSIGNED` | Admin assigns an arbiter to an engagement | In-app, SSE, Email | — |
| `ARBITER_REASSIGNED` | Admin reassigns an arbiter (old arbiter notified) | In-app, SSE, Email | — |
| `ARBITER_RECUSAL_REQUESTED` | Arbiter recuses themselves from an engagement | In-app, SSE, Email | — |
| `ACCOUNT_MERGE_DETECTED` | Merge detector cron flags a merged Stellar account | In-app, SSE, Email | — |

Types without a dedicated email template still send an email using the base template with the notification's `message` text.

---

## Email Templates

### Location

```
src/common/email/templates/
├── base.html                              — shared layout (header, footer, CTA button)
├── ENGAGEMENT_CREATED.html
├── ENGAGEMENT_CANCELLED.html
├── MILESTONE_CONFIRMED.html
├── PAYMENT_RELEASED.html
├── DISPUTE_RAISED.html
├── DISPUTE_RESOLVED.html
├── REPLICATION_REQUESTED.html
└── RETENTION_WINDOW_APPROACHING.html
```

### How Templates Work

Templates are Handlebars `.html` files rendered by Nodemailer. Each extends `base.html` and overrides content blocks.

**Common variables available in all templates:**

| Variable | Type | Description |
|----------|------|-------------|
| `subject` | string | Email subject line (prefixed with a per-type emoji) |
| `message` | string | Human-readable notification body |
| `ctaLink` | string? | Optional URL for a call-to-action button |
| `year` | string | Current year for the footer |

**Type-specific variables:**

| Template | Extra Variables |
|----------|-----------------|
| `ENGAGEMENT_CREATED` | `engagementTitle` |
| `MILESTONE_CONFIRMED` | `engagementTitle`, `milestoneIndex` |
| `PAYMENT_RELEASED` | `engagementTitle`, `milestoneIndex`, `amount` |
| `DISPUTE_RAISED` | `engagementTitle`, `milestoneIndex`, `reason` |
| `DISPUTE_RESOLVED` | `engagementTitle`, `milestoneIndex`, `resolution` |
| `ENGAGEMENT_CANCELLED` | `engagementTitle`, `reason` |
| `REPLACEMENT_REQUESTED` | `engagementTitle` |
| `RETENTION_WINDOW_APPROACHING` | `engagementTitle`, `milestoneIndex` |

### Adding a New Template

1. Create `src/common/email/templates/NEW_TYPE.html` using Handlebars syntax.
2. Extend `base.html` with `{{#partial "content"}}`.
3. The service derives the template name from `type.toLowerCase()` (e.g. `NEW_TYPE` → `new_type`), so the filename must match exactly.

---

## User Preferences (Email Opt-Out)

Users can control which notification types send emails. The preference system is per-type with a single boolean toggle.

### Defaults

- Email is **enabled by default** for every type.
- No preference record exists until the user explicitly changes a setting.
- Preferences **only control the email channel**. In-app records are always created and SSE pushes always fire regardless of the preference.

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/users/me/notification-preferences` | Returns all 14 types with current `emailEnabled` status. Types with no saved record default to `true`. |
| `PUT` | `/users/me/notification-preferences` | Upserts preferences. Body: `{ preferences: [{ type: "PAYMENT_RELEASED", emailEnabled: false }, ...] }` |

### Data Model

```prisma
model NotificationPreference {
  id           String           @id @default(uuid())
  userId       String
  type         NotificationType
  emailEnabled Boolean          @default(true)
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, type])
}
```

---

## Slack Integration

Companies that want alerts in their team Slack channel can configure an incoming webhook. When set, key notification types are posted to that channel in a readable Blocks format (header + message + link back to the app) — never raw JSON.

### Key Notification Types

Only these company-facing, actionable types are posted to Slack:

- `ENGAGEMENT_CREATED`, `PROOF_SUBMITTED`, `MILESTONE_CONFIRMED`, `PAYMENT_RELEASED`
- `DISPUTE_RAISED`, `DISPUTE_RESOLVED`, `REPLACEMENT_REQUESTED`, `ENGAGEMENT_CANCELLED`
- `FUNDING_SHORTFALL_DETECTED`

Other types stay in-app/email-only even when a webhook is configured.

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `PUT` | `/users/me/slack-webhook` | Set the webhook. Body: `{ "url": "https://hooks.slack.com/services/<team-id>/<webhook-id>/<token>" }` (https only) |
| `DELETE` | `/users/me/slack-webhook` | Clear the webhook (disables Slack alerts) |
| `GET` | `/users/me` | Profile includes the current `slackWebhookUrl` (or `null`) |

### Data Model

Stored as `slackWebhookUrl` on the `users` table (nullable, no default — Slack is off until a company opts in).

### Delivery

Sends run through the BullMQ `slack` queue (3 attempts, exponential backoff). A failed webhook call is retried by the queue and logged; it never blocks notification creation.

---

## SSE (Server-Sent Events)

### Connecting

```
GET /notifications/stream
Authorization: Bearer <token>
```

The endpoint returns a long-lived `text/event-stream` response. Each notification is pushed as:

```
data: {"id":"...","type":"PAYMENT_RELEASED","title":"...","message":"...","data":{...}}

```

### Behavior

- Multiple connections per user are supported.
- Connections are stored in memory; they do not survive a server restart.
- If no SSE connection is open when a notification fires, the client must poll `GET /notifications` to retrieve it.
- A keep-alive comment (`: keep-alive`) is sent on connection and periodically to prevent proxy timeouts.

---

## Cleanup

A daily cron (`notification-cleanup.service.ts`) deletes notifications that are:

- **Read** (`read = true`), AND
- Older than `NOTIFICATION_RETENTION_DAYS` (default: 90 days, configurable via env var)

Unread notifications are never auto-deleted.

---

## Notification Dispatchers

| Service | Types Dispatched |
|---------|-----------------|
| `EventsService` | Chain-event-driven: `ENGAGEMENT_CREATED`, `MILESTONE_UNLOCKED`, `PROOF_SUBMITTED`, `PAYMENT_RELEASED`, `DISPUTE_RAISED`, `DISPUTE_RESOLVED`, `REPLACEMENT_REQUESTED`, `ENGAGEMENT_CANCELLED` |
| `RetentionsSchedulerService` | Cron-driven: `RETENTION_WINDOW_APPROACHING`, `MILESTONE_UNLOCKED` |
| `EngagementsService` | `ENGAGEMENT_CANCELLED`, `REPLACEMENT_REQUESTED`, `ARBITER_RECUSAL_REQUESTED` |
| `MilestonesService` | `MILESTONE_CONFIRMED` (admin override); also direct DB writes for `PROOF_SUBMITTED`, `PAYMENT_RELEASED`, `DISPUTE_RAISED`, `DISPUTE_RESOLVED` |
| `AdminUsersService` | `ARBITER_ASSIGNED`, `ARBITER_REASSIGNED` |
| `StellarMergeDetectorService` | `ACCOUNT_MERGE_DETECTED` (cron every 5 min) |

---

## SMTP Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `SMTP_HOST` | Yes | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | Yes | — | SMTP auth username |
| `SMTP_PASS` | Yes | — | SMTP auth password |
| `EMAIL_FROM` | No | `noreply@hiresettle.com` | Sender address |
