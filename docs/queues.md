# BullMQ Queues

HireSettle uses [BullMQ](https://docs.bullmq.io/) backed by Redis for all
async job processing. Five named queues handle email delivery, Stellar
on-chain transactions, outbound webhooks, and third-party chat notifications.

---

## Queue overview

| Queue name | Processor | Attempts | Backoff | Producer(s) |
|---|---|---|---|---|
| `email` | `EmailProcessor` | 3 | exponential, 2 s base | `NotificationsService` |
| `stellar-tx` | `StellarTxProcessor` | 5 | exponential, 5 s base | `MilestonesService` / `AdminDisputesController` |
| `webhook` | `WebhookProcessor` | 3 | exponential, 2 s base | `WebhooksService` |
| `slack` | `SlackProcessor` | 3 | exponential, 2 s base | `NotificationsService` |
| `discord` | `DiscordProcessor` | 3 | exponential, 2 s base | `NotificationsService` |

All queues share one Redis connection configured by `REDIS_URL` (see
[`src/app.module.ts`](../src/app.module.ts) and
[Environment Variables](./environment-variables.md)).

---

## Queue details

### `email`

Sends transactional emails through the configured SMTP transport.

**Enqueued by:** `NotificationsService.notifyUserById()` whenever a user has
`emailEnabled: true` for the notification type being dispatched.

**Job name:** `send`

**Job payload:**

```ts
interface EmailJobData {
  to: string;             // recipient address
  subject: string;
  message: string;
  type: NotificationType; // e.g. ENGAGEMENT_CREATED
  notificationId?: string;
  data?: Record<string, any>;
  locale?: string;        // defaults to 'en'
}
```

**Retry settings:** 3 attempts, exponential backoff starting at 2 s
(2 s → 4 s → 8 s).

---

### `stellar-tx`

Submits signed Soroban transactions to the Stellar network. This queue
exists to decouple HTTP request latency from on-chain confirmation time and
to guarantee retries in case of network timeouts.

**Enqueued by:** Services that trigger on-chain state changes
(milestone payment release, dispute resolution, retention unlock).

**Job name:** `process`

**Job payload:**

```ts
type StellarTxAction = 'release_payment' | 'resolve_dispute' | 'unlock_milestone';

interface StellarTxJobData {
  action: StellarTxAction;
  engagementId: string;
  milestoneIndex: number;
  approved?: boolean; // used by 'resolve_dispute' — true = approve, false = reject
}
```

**Action semantics:**

| Action | Calls | When |
|---|---|---|
| `release_payment` | `StellarService.releaseMilestonePayment()` | Company confirms milestone |
| `resolve_dispute` | `StellarService.resolveMilestoneDispute()` | Admin resolves a dispute |
| `unlock_milestone` | `StellarService.unlockRetentionMilestone()` | Retention period expires |

**Retry settings:** 5 attempts, exponential backoff starting at 5 s
(5 s → 10 s → 20 s → 40 s → 80 s).

---

### `webhook`

Delivers outbound HTTP webhook payloads to subscriber URLs. Supports
HMAC-SHA-256 request signing when the subscription has a `secret`.

**Enqueued by:** `WebhooksService.sendWebhook()` — called from engagement and
milestone lifecycle hooks whenever a user has an active webhook subscription.

**Job name:** `send`

**Job payload:**

```ts
interface WebhookJobData {
  url: string;
  payload: WebhookPayload; // { event, engagementId, status, timestamp }
  userId?: string;         // owner of the subscription (for failure records)
  secret?: string;         // HMAC secret, if signing is configured
}
```

**Supported events:** `COMPLETED`, `CANCELLED`, `REPLACEMENT_REQUESTED`,
`DISPUTE_RAISED`, `PAYMENT_RELEASED`.

**Failure handling:** After all attempts are exhausted the `failed` worker
event handler writes a `WebhookDelivery` row (with `errorMessage`) so
admins can inspect and re-trigger deliveries from the admin panel.

**Retry settings:** 3 attempts, exponential backoff starting at 2 s.

---

### `slack`

Posts structured Slack Block Kit messages to a company's incoming webhook URL.

**Enqueued by:** `NotificationsService.notifyUserById()` when:
1. the user has `slackWebhookUrl` set, **and**
2. the notification type is one of the key company-facing types (e.g.
   `ENGAGEMENT_CREATED`, `PROOF_SUBMITTED`, `MILESTONE_CONFIRMED`,
   `PAYMENT_RELEASED`, `DISPUTE_RAISED`, …).

**Job name:** `send`

**Job payload:**

```ts
interface SlackJobData {
  webhookUrl: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>; // optional structured context (amount, reason, …)
}
```

**Retry settings:** 3 attempts, exponential backoff starting at 2 s.

---

### `discord`

Mirrors the Slack queue but targets Discord incoming webhook URLs.

**Enqueued by:** `NotificationsService.notifyUserById()` when the user has
`discordWebhookUrl` set and the notification type matches the Discord
key-type list.

**Job name:** `send`

**Job payload:**

```ts
interface DiscordJobData {
  webhookUrl: string;
  type: NotificationType;
  title: string;
  message: string;
}
```

**Retry settings:** 3 attempts, exponential backoff starting at 2 s.

---

## Opening Bull Board locally

Bull Board is mounted at `/admin/queues` in `development` mode only. It is
**disabled in production**.

### Prerequisites

- The app is running locally (`npm run start:dev`).
- You have an active session token for a user with the `ADMIN` role.

### Steps

1. Obtain a JWT for your admin user via `POST /api/v1/auth/login`.
2. Open `http://localhost:3000/admin/queues` in your browser.
3. The middleware at `/admin/queues` validates the `Authorization: Bearer <token>`
   header and checks that `payload.role === 'ADMIN'`. Because browsers cannot
   send custom headers for page loads, use a tool such as **Requestly** or open
   the URL with a REST client first to confirm access, then paste the URL with
   a bearer token in the dev-tools Network panel if needed.
4. Alternatively, use the [Swagger UI](http://localhost:3000/docs) to obtain
   the token and make authenticated requests.

> **Tip:** All five queues (`email`, `stellar-tx`, `webhook`, `slack`,
> `discord`) are visible in Bull Board. You can inspect waiting, active,
> completed, and failed jobs for each queue, and manually retry individual
> failed jobs directly from the UI.

---

## Dead-letter events and requeueing

Dead-letter events are **Stellar chain events** (not BullMQ jobs) that failed
processing after their maximum retry count. They are stored in the
`dead_letter_events` table via `DeadLetterEvent`.

### How events end up there

1. `ChainEventRetryService` polls for unprocessed `chain_events` rows.
2. On each failure the row's `retryCount` is incremented.
3. Once `retryCount` exceeds the configured maximum, the event is upserted
   into `dead_letter_events` (keyed on `originalId`) and the original
   `chain_events` row is marked as abandoned.

### Inspecting dead-letter events

```http
GET /api/v1/admin/dead-letter-events?page=1&limit=20
Authorization: Bearer <admin-token>
```

Returns a paginated list with `{ data, meta: { total, page, limit } }`.

### Requeueing a dead-letter event

```http
POST /api/v1/admin/dead-letter-events/:id/requeue
Authorization: Bearer <admin-token>
```

This endpoint (handled by `AdminDeadLetterService.requeue()`):
1. Looks up the `DeadLetterEvent` by `id`.
2. In a single transaction, creates a new `chain_events` row (resetting
   `retryCount` to `0`) and deletes the dead-letter record.
3. The event re-enters the normal processing pipeline on the next poll cycle.

> **Note:** BullMQ itself does not produce `DeadLetterEvent` records. Failed
> *webhook* deliveries are stored in `webhook_deliveries` (via
> `WebhookProcessor.onFailed`). Dead-letter events exclusively track
> failures in the on-chain Stellar event processing pipeline.
