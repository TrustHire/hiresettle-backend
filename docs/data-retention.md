# Data Retention Policy

This document describes how HireSettle stores, retains, and erases personal data (PII) across the platform's lifecycle stages, and specifies the scheduled jobs that enforce each retention window.

---

## Retention windows

| Data category | Default window | Env var | Notes |
|---|---|---|---|
| Read notifications | 90 days | `RETENTION_NOTIFICATIONS_DAYS` | Deleted by `DataRetentionService` |
| Unread notifications | 365 days | `RETENTION_NOTIFICATIONS_UNREAD_DAYS` | Deleted by `DataRetentionService`; set to `-1` to keep indefinitely |
| Security events | 365 days | `RETENTION_SECURITY_EVENTS_DAYS` | Entire row deleted by `DataRetentionService` |
| Expired idempotency keys | per-row `expiresAt` | `RETENTION_IDEMPOTENCY_KEYS_DAYS` | Set to `0` (default) to enable; `-1` to disable |
| Stale refresh tokens | 30 days | `RETENTION_REFRESH_TOKENS_DAYS` | Only consumed / revoked / past-expiry tokens |
| Processed deletion requests | 365 days | `RETENTION_DATA_DELETION_REQS_DAYS` | Only rows with `processedAt IS NOT NULL` |
| PII fields on deleted accounts | 30 days after `deletedAt` | `PII_ANONYMIZATION_WINDOW_DAYS` | Fields scrubbed by `PiiAnonymizationSchedulerService` |

All windows are configurable via environment variables. Setting a window to **`-1`** disables that category entirely — useful for compliance environments that require manual review before deletion.

---

## Scheduled jobs

| Service | Schedule (UTC) | What it does |
|---|---|---|
| `DataRetentionService` | 03:00 daily | Enforces all per-category retention windows; logs a per-category summary |
| `PiiAnonymizationSchedulerService` | 04:00 daily | Full PII field scrub for accounts past `PII_ANONYMIZATION_WINDOW_DAYS` since `deletedAt` |
| `S3CleanupService` | 03:00 daily | Removes orphaned S3 avatar/evidence objects not referenced in the DB |

> **Previously** `NotificationCleanupService` (02:00) and `GdprService.purgeExpiredRecords` (03:00) each deleted notification and security-event rows independently, using different filters and different env vars. Both have been consolidated into `DataRetentionService`. The old env vars (`NOTIFICATION_RETENTION_DAYS`, `DATA_RETENTION_DAYS`) are retained in the Joi schema for backward compatibility but are no longer read by any active cron.

---

## `DataRetentionService` — per-run log format

Each run appends a structured summary to the application log, regardless of whether any records were deleted:

```
Data retention job completed in 142ms
Total records deleted: 1847
  [notifications.read]          deleted 1203
  [notifications.unread]        deleted 0
  [security_events]             deleted 441
  [idempotency_keys]            deleted 193
  [refresh_tokens]              deleted 10
  [data_deletion_requests]      deleted 0
```

If a category is disabled (`-1`) the line reads `skipped (disabled)`. If a category fails the line reads `ERROR — <message>` and the job continues with the remaining categories.

---

## Account deletion lifecycle

Account deletion is a two-phase process.

### Phase 1 — Erasure request (`deletedAt` set)

Triggered by `DELETE /users/me` (user-initiated) or `DELETE /admin/users/:id` (admin-initiated).

Actions that happen **immediately**:

- `name` and `email` are nulled on the `users` row.
- `deletedAt` is stamped with the current timestamp.
- A `DataDeletionRequest` record is created for admin review.

The account is no longer accessible for login at this point.

### Phase 2 — Full PII scrub (`anonymizedAt` set)

Runs automatically via `PiiAnonymizationSchedulerService` (04:00 UTC daily) once `PII_ANONYMIZATION_WINDOW_DAYS` days have elapsed since `deletedAt`.

| Action | Detail |
|---|---|
| `email` → `null` | Already nulled in Phase 1; idempotent |
| `name` → `null` | Already nulled in Phase 1; idempotent |
| `company` → `null` | Company name removed |
| `avatarUrl` → `null` | CDN reference removed; S3 object deleted first |
| `passwordHash` → `null` | Credential scrubbed |
| `webhookUrl` → `null` | Endpoint URL removed |
| `webhookSecret` → `null` | HMAC signing secret scrubbed |
| `totpSecret` → `null` | 2FA seed scrubbed |
| `totpEnabled` → `false` | Consistent state with nulled secret |
| `failedLoginAttempts` → `0` | Reset to safe default |
| `lockedUntil` → `null` | Cleared |
| `rateLimitOverride` → `null` | Cleared |
| RefreshTokens | All active tokens revoked (`revokedAt` stamped) |
| Notifications | All rows hard-deleted |
| NotificationPreferences | All rows hard-deleted |
| SecurityEvents | `ip` and `userAgent` nulled; `action` and `createdAt` preserved for audit |
| `anonymizedAt` | Stamped with the scrub completion timestamp |

### Fields intentionally preserved after Phase 2

| Field | Reason |
|---|---|
| `id` | Primary key; required for FK integrity across audit/engagement records |
| `stellarAddress` | Join key on `Engagement` rows (`companyAddress`, `recruiterAddress`, `arbiterAddress`); removing it would corrupt financial history |
| `role` | Required for audit log interpretation |
| `deactivatedAt` | Operational record |
| `deletedAt` | GDPR audit trail — proves erasure was requested |
| `anonymizedAt` | Idempotency marker + GDPR audit trail — proves scrub completed |
| `createdAt` | Account creation timestamp — non-PII |

### Records never modified or deleted

The following records are **never touched** by any retention job because they form the financial and compliance audit trail:

- `Engagement`, `Milestone`, `ChainEvent` rows — on-chain immutable records
- `EngagementAuditLog`, `MilestoneAuditLog` rows — status transition history
- `AuditLog` rows — admin override records
- `DisputeEvidence` rows — legal evidence for resolved disputes
- `WebhookDelivery` rows — delivery failure records

---

## Requesting erasure (user procedure)

1. Authenticate and call `DELETE /users/me` — Phase 1 fires immediately (see [Account deletion lifecycle](#account-deletion-lifecycle)).
2. A `204 No Content` response confirms the request was accepted; your account is inaccessible for login at this point.
3. Full PII scrub completes automatically within `PII_ANONYMIZATION_WINDOW_DAYS` days (default 30) via the 04:00 UTC scheduled job.
4. To confirm scrub completion, contact support — admins can verify the `anonymizedAt` timestamp via `GET /admin/users/:id`.

---

## Admin workflow

1. A user submits `DELETE /users/me` → Phase 1 fires immediately; a `DataDeletionRequest` is queued.
2. Admins review the queue at `GET /admin/data-deletion-requests`.
3. An admin marks a request processed via `POST /admin/data-deletion-requests/:id/process`.
4. After `PII_ANONYMIZATION_WINDOW_DAYS` days the 04:00 cron fires Phase 2 automatically, regardless of whether an admin has marked the request as processed.
5. Processed `DataDeletionRequest` rows are themselves deleted by `DataRetentionService` after `RETENTION_DATA_DELETION_REQS_DAYS` days (default 365).

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `RETENTION_NOTIFICATIONS_DAYS` | `90` | Days before **read** notifications are deleted. `-1` = disabled |
| `RETENTION_NOTIFICATIONS_UNREAD_DAYS` | `365` | Days before **unread** notifications are deleted. `-1` = keep indefinitely |
| `RETENTION_SECURITY_EVENTS_DAYS` | `365` | Days before `security_events` rows are deleted. `-1` = disabled |
| `RETENTION_IDEMPOTENCY_KEYS_DAYS` | `0` | `0` = enabled (uses per-row `expiresAt`). `-1` = disabled |
| `RETENTION_REFRESH_TOKENS_DAYS` | `30` | Days before stale (consumed/revoked/expired) refresh tokens are deleted. `-1` = disabled |
| `RETENTION_DATA_DELETION_REQS_DAYS` | `365` | Days before processed `data_deletion_requests` rows are deleted. `-1` = disabled |
| `PII_ANONYMIZATION_WINDOW_DAYS` | `30` | Days after `deletedAt` before the full PII scrub runs |
| `NOTIFICATION_RETENTION_DAYS` | `90` | **Deprecated** — no longer read by any active cron; kept for backward compatibility |
| `DATA_RETENTION_DAYS` | `365` | **Deprecated** — no longer read by any active cron; kept for backward compatibility |
