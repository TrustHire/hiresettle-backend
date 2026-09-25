# Feature Flags

HireSettle uses a lightweight database-backed feature flag system to enable or
disable functionality at runtime without a code deployment. Flags are stored in
the `feature_flags` table, served through `FeatureFlagsService`, and managed
via admin API endpoints.

---

## How it works

1. A flag is a named boolean record in the database (`feature_flags.name`,
   `feature_flags.is_enabled`).
2. `FeatureFlagsService.isEnabled(name)` checks a Redis cache first (TTL: 60 s)
   and falls back to the database on a cache miss.
3. Toggling a flag via the API upserts the database record and immediately
   invalidates the cache entry so the change takes effect within one request.

---

## Naming convention

Flag names **must** use `snake_case` and describe the feature they gate, not
the ticket that introduced them.

| Good | Bad |
|---|---|
| `team_invites` | `TeamInvites` |
| `bulk_milestone_update` | `issue-262` |
| `weekly_digest` | `weeklyDigest` |
| `graphql_mutations` | `GRAPHQL_MUTATIONS` |

Keep names short and unambiguous. Once a flag is in production, renaming it
requires a data migration — choose carefully.

---

## Checking a flag inside a service

Inject `FeatureFlagsService` and call `isEnabled()` before the guarded code
path:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Injectable()
export class ExampleService {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  async doSomethingNew(): Promise<void> {
    const enabled = await this.featureFlags.isEnabled('my_new_feature');
    if (!enabled) {
      throw new BadRequestException('my_new_feature is currently disabled');
    }

    // ... feature implementation
  }
}
```

**Real-world example** — `TeamInvitesController` gates the send-invite endpoint:

```ts
// src/modules/team-invites/team-invites.controller.ts
const isEnabled = await this.featureFlagsService.isEnabled('team_invites');
if (!isEnabled) {
  throw new BadRequestException('Team invites feature is currently disabled');
}
```

### Making the service available in your module

`FeatureFlagsModule` exports `FeatureFlagsService`. Import the module in any
NestJS module that needs flag checks:

```ts
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [FeatureFlagsModule],
  providers: [ExampleService],
})
export class ExampleModule {}
```

---

## Creating a new flag

Flags are created lazily — `setFlag()` uses an upsert, so calling the
`PUT` endpoint with a new name creates the flag automatically.

### Via the admin API

```http
PUT /api/v1/admin/feature-flags/my_new_feature
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "isEnabled": false,
  "description": "Enables the new experimental feature for selected users."
}
```

**Response:**

```json
{
  "name": "my_new_feature",
  "isEnabled": false,
  "description": "Enables the new experimental feature for selected users.",
  "createdAt": "2026-09-25T10:00:00.000Z",
  "updatedAt": "2026-09-25T10:00:00.000Z"
}
```

> **Best practice:** Always create a flag in the **disabled** state first
> (`"isEnabled": false`), deploy the code that checks it, then enable it once
> you are ready to roll out.

---

## Toggling a flag

Use the same `PUT` endpoint to enable or disable an existing flag:

```http
PUT /api/v1/admin/feature-flags/my_new_feature
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "isEnabled": true
}
```

The cache entry for this flag is invalidated immediately. All subsequent calls
to `isEnabled('my_new_feature')` will reflect the new value within the next
request (cache TTL does not need to expire first).

---

## Listing all flags

```http
GET /api/v1/admin/feature-flags
Authorization: Bearer <admin-jwt>
```

**Response:**

```json
[
  {
    "name": "bulk_milestone_update",
    "isEnabled": true,
    "description": "Allows batch status updates for milestones.",
    "createdAt": "2026-07-01T00:00:00.000Z",
    "updatedAt": "2026-07-01T00:00:00.000Z"
  },
  {
    "name": "team_invites",
    "isEnabled": true,
    "description": "Enables team member invitations for company accounts.",
    "createdAt": "2026-06-25T00:00:00.000Z",
    "updatedAt": "2026-09-01T00:00:00.000Z"
  }
]
```

Results are ordered alphabetically by `name`.

---

## Admin API reference

All endpoints require the `ADMIN` role (JWT bearer token or API key with
`X-Api-Key` header).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/feature-flags` | List all feature flags. |
| `PUT` | `/api/v1/admin/feature-flags/:name` | Create or update a flag by name. |

### `PUT` request body (`UpdateFeatureFlagDto`)

| Field | Type | Required | Description |
|---|---|---|---|
| `isEnabled` | `boolean` | **yes** | Whether the flag is enabled. |
| `description` | `string` | no | Human-readable description of the flag's purpose. |

---

## Caching behaviour

`FeatureFlagsService` caches each flag value in Redis under the key
`feature_flag:<name>` with a TTL of **60 seconds**.

| Situation | Behaviour |
|---|---|
| Redis unavailable (read) | Falls back to the database silently; logs a warning. |
| Redis unavailable (write) | Proceeds without caching; logs a warning. |
| Flag toggled via API | Cache entry deleted immediately; next read re-populates from DB. |
| Flag not found in DB | Returns `false` (disabled by default). |

---

## Removing a flag

There is no delete endpoint. To remove a flag:

1. Remove all `isEnabled()` calls for it from the codebase and deploy.
2. Delete the row directly from the database:

```sql
DELETE FROM feature_flags WHERE name = 'my_old_feature';
```
