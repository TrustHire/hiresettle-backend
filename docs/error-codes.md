# Error Codes

API error responses and how to handle them.

## Standard Error Envelope

Every error response follows this shape (produced by the global `HttpExceptionFilter`):

```json
{
  "success": false,
  "statusCode": 400,
  "timestamp": "2026-07-26T12:00:00.000Z",
  "path": "/engagements",
  "message": "Token xlm is not allowed"
}
```

**Contrast with success responses** (produced by `TransformInterceptor`):

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-07-26T12:00:00.000Z"
}
```

The `message` field is always a string. There is no machine-readable error code; consumers should branch on `statusCode` and match on `message` content where needed.

---

## 400 — Bad Request

Request is malformed, fails validation, or violates a business rule.

### Validation Errors

Thrown by the global `ValidationPipe` when DTO constraints fail. The `message` is a JSON array of error strings:

```json
{
  "success": false,
  "statusCode": 400,
  "timestamp": "2026-07-26T12:00:00.000Z",
  "path": "/auth/register",
  "message": ["email must be an email", "password must be longer than or equal to 8 characters"]
}
```

The global pipe is configured with `whitelist: true` and `forbidNonWhitelisted: true`, so unknown properties also trigger a 400.

### Business Rule Errors

| Message | Context |
|---------|---------|
| `Token <address> is not allowed` | Engagement creation with a token not in the allowlist |
| `Insufficient token balance. Required: <n>, available: <n>` | Company cannot fund the escrow |
| `jobTitle is required (either provide it or use a template)` | Missing field after template merge |
| `milestones are required (either provide them or use a template)` | Missing milestones after template merge |
| `Milestone paymentPercent values must sum to exactly 100` | Milestone percentages invalid |
| `Stellar address does not exist or is not funded.` | Registration with an unfunded account |
| `Invalid Stellar address format` | Public profile lookup with bad address |
| `No file provided` | File upload endpoint received no file |
| `Invalid file type. Allowed: ...` | Wrong MIME type on file upload |
| `File size exceeds 10 MB limit` (evidence) / `2 MB limit` (avatar) | Upload too large |
| `stellarAddress is immutable and cannot be updated` | Profile update attempt |
| `Invalid date format. Use ISO 8601 (e.g. 2026-01-01).` | Admin report or security events query |
| `"from" must be before "to".` | Date range reversed |
| `Date range cannot exceed 90 days.` | Admin report date range too wide |
| `User is already deactivated` / `User is not deactivated` | Admin toggle on wrong state |
| `User is not an arbiter` / `Arbiter has no stellar address` | Arbiter assignment failure |

### Stellar Transaction Errors (also 400)

These occur during engagement creation via the older `submitCreateEngagement` path:

| Message | Meaning |
|---------|---------|
| `Backend Stellar keypair not configured` | Server env misconfigured |
| `Contract simulation failed: <error>` | Soroban simulation rejected the transaction |
| `Transaction submission failed: <error>` | Stellar RPC rejected the submission |
| `Transaction not confirmed: <status>` | Confirmation timed out |

---

## 401 — Unauthorized

Missing, expired, or invalid authentication token.

| Message | Context |
|---------|---------|
| `Invalid token type` | JWT `type` claim is not `access` |
| `Invalid email or password` | Login credentials wrong |
| `Invalid refresh token` | Refresh token not found in DB |
| `Refresh token reuse detected` | Refresh token was already consumed |
| `Refresh token is no longer valid` | Token revoked or expired |

Passport's `JwtAuthGuard` also returns 401 automatically when no `Authorization: Bearer <token>` header is present or the token is malformed.

---

## 403 — Forbidden

Authenticated but not authorized for the requested action.

| Message | Context |
|---------|---------|
| `No role found in token. Access denied.` | JWT has no `role` claim |
| `Role '<role>' is not authorised. Required: <roles>` | User role doesn't match endpoint requirements |
| `Your account has been deactivated. Please contact an administrator.` | Deactivated user attempting login |
| `You do not have access to this engagement` | User is not a party to the engagement |
| `Not authorized to use this template` / `Not authorized to access this template` | Template belongs to another company |
| `Only the company party may cancel this engagement` | Non-company user trying to cancel |
| `Only the company party may request a candidate replacement` | Non-company user |
| `Only the assigned arbiter can recuse themselves` | Wrong user attempting recusal |
| `Not a party to this engagement` | Milestone query by non-party |
| `Access denied` | Metrics endpoint |

---

## 404 — Not Found

Resource does not exist or the ID is invalid.

| Message Pattern | Context |
|-----------------|---------|
| `Engagement <id> not found` | Engagement lookup by ID |
| `Engagement not found` | Engagement summary or cancel |
| `Template <id> not found` | Engagement template lookup |
| `Milestone <index> not found on engagement <id>` | Milestone lookup by index |
| `Milestone <id> not found` | Milestone lookup by DB ID |
| `User not found` | Profile lookup or admin user action |
| `Recruiter not found` | Recruiter stats/engagements (may also indicate incomplete profile) |
| `Dead-letter event <id> not found` | Admin dead-letter requeue |

---

## 409 — Conflict

Request conflicts with the current state of the resource.

| Message | Context |
|---------|---------|
| `Email or Stellar address is already registered` | Duplicate registration |
| `Engagement <id> already exists` | Duplicate engagement creation |
| `Cannot cancel an engagement with status '<status>'` | Engagement already cancelled/completed |
| `Cannot request replacement for an engagement with status '<status>'` | Engagement in terminal state |

---

## 422 — Unprocessable Entity

The request is well-formed but the milestone is in the wrong state for the requested operation.

| Message | Context |
|---------|---------|
| `Milestone must be PENDING to submit proof.` | Proof submitted on non-PENDING milestone |
| `Milestone proof must be submitted before confirmation.` | Confirmation without proof |
| `Can only dispute milestones that have proof submitted.` | Dispute on unproven milestone |
| `Milestone is not under an active dispute phase.` | Resolution on non-disputed milestone |

---

## 429 — Too Many Requests

Rate limit exceeded. The `TooManyRequestsHeadersFilter` adds retry headers:

```
Retry-After: 60
X-RateLimit-Reset: <unix timestamp + 60>
```

### Default Limits

| Scope | Limit | TTL | Key |
|-------|-------|-----|-----|
| Global (all endpoints) | 100 | 60 s | IP address |
| Auth login / wallet-login | 10 | 60 s | IP address |
| Engagements, milestones, events, notifications, templates, recruiters | 100 | 60 s | JWT `sub` (user ID) |

The per-user throttle (`UserJwtSubThrottlerGuard`) uses the JWT subject instead of IP, so unauthenticated users share a single `"anonymous"` bucket.

---

## 500 — Internal Server Error

Unexpected failure. The message is always the generic string `Internal server error` — no implementation details are exposed.

Internal `StellarError` codes (logged server-side but not returned to clients):

| Internal Code | Meaning |
|---------------|---------|
| `KEYPAIR_NOT_CONFIGURED` | Backend signing key not set |
| `SIMULATION_FAILED` | Soroban simulation rejected |
| `SUBMISSION_FAILED` | Stellar RPC submission failed |
| `CONFIRMATION_TIMEOUT` | Transaction not confirmed in 30 s |
| `TRANSACTION_FAILED` | Transaction failed on-chain |
| `ACCOUNT_NOT_FOUND` | Signer account missing from Horizon |

---

## Non-Standard Responses

The Bull Board admin queue proxy (`/admin/queues`) bypasses NestJS filters and returns a reduced shape:

```json
{ "message": "Unauthorized" }
```

```json
{ "message": "Forbidden" }
```

These lack the `success`, `statusCode`, `timestamp`, and `path` fields. This only affects `/admin/queues`.
