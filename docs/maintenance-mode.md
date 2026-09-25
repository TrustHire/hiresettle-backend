# API Maintenance Mode

HireSettle backend features a dynamic maintenance mode (read-only mode) that can be enabled and disabled at runtime by administrators without requiring service restarts.

When maintenance mode is active, read operations continue to function normally, while write operations (mutations) are rejected with HTTP `503 Service Unavailable`.

---

## Architecture & Enforcement

Maintenance mode is managed by `src/common/maintenance/` and enforced globally across all endpoints:

1. **Global Guard (`MaintenanceModeGuard`)**:
   Registered as an `APP_GUARD` in `MaintenanceModeModule`. It intercepts every incoming HTTP request.
2. **State Storage (`SystemConfig`)**:
   The active state is stored in the database via Prisma under the `systemConfig` table with the key `maintenance_mode` (`"true"` or `"false"`).
3. **Bypass Decorator (`@AllowDuringMaintenance`)**:
   Endpoints marked with `@AllowDuringMaintenance()` bypass the guard, allowing administrators to disable maintenance mode even while active.

---

## Managing Maintenance Mode

Both maintenance endpoints require an authenticated administrator account (`ADMIN` role) using either a Bearer JWT token or an `X-Api-Key` header.

### 1. Check Current Status

- **Method**: `GET`
- **Path**: `/api/v1/admin/maintenance-mode`
- **Headers**:
  - `Authorization: Bearer <ADMIN_JWT>` (or `X-Api-Key: <ADMIN_API_KEY>`)

**Example Request:**

```sh
curl -X GET "https://api.hiresettle.com/api/v1/admin/maintenance-mode" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

**Response (`200 OK`):**

```json
{
  "enabled": false
}
```

### 2. Enable or Disable Maintenance Mode

- **Method**: `PUT`
- **Path**: `/api/v1/admin/maintenance-mode`
- **Headers**:
  - `Authorization: Bearer <ADMIN_JWT>` (or `X-Api-Key: <ADMIN_API_KEY>`)
  - `Content-Type: application/json`

**Enable Maintenance Mode (Read-Only):**

```sh
curl -X PUT "https://api.hiresettle.com/api/v1/admin/maintenance-mode" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

**Disable Maintenance Mode (Resume Normal Operation):**

```sh
curl -X PUT "https://api.hiresettle.com/api/v1/admin/maintenance-mode" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

**Response (`200 OK`):**

```json
{
  "enabled": true
}
```

_(Note: `PUT /api/v1/admin/maintenance-mode` is decorated with `@AllowDuringMaintenance()`, ensuring administrators can always toggle it back off without getting locked out)._

---

## Traffic Behavior: Allowed vs Blocked Requests

| HTTP Method                      | Route Type                       | Status During Maintenance | Behavior                                                                                              |
| :------------------------------- | :------------------------------- | :------------------------ | :---------------------------------------------------------------------------------------------------- |
| `GET`, `HEAD`, `OPTIONS`         | All routes                       | **Allowed**               | Requests proceed normally to controllers. Read-only queries, status checks, and data fetches succeed. |
| `PUT`                            | `/api/v1/admin/maintenance-mode` | **Allowed**               | Bypasses guard via `@AllowDuringMaintenance()` to permit status changes.                              |
| `POST`, `PUT`, `PATCH`, `DELETE` | All other routes                 | **Blocked**               | Blocked immediately with HTTP `503 Service Unavailable`.                                              |

### Error Response Shape

When a mutation request is blocked by `MaintenanceModeGuard`, the API returns standard NestJS error response:

- **HTTP Status Code**: `503 Service Unavailable`
- **Response Headers**: `Content-Type: application/json`
- **Response Body**:

```json
{
  "statusCode": 503,
  "message": "The API is in maintenance mode. Write operations are temporarily unavailable.",
  "error": "Service Unavailable"
}
```

### Guidance for API Consumers & Frontend

1. **Detection**: Clients and frontend applications should inspect response status `503` with message `"The API is in maintenance mode. Write operations are temporarily unavailable."`.
2. **User Experience**: Display a non-intrusive banner or toast indicating that the platform is in scheduled maintenance and write actions (e.g. creating engagements, submitting milestone releases, updating profiles) are temporarily disabled.
3. **Idempotency**: Do not continuously retry failed mutations in background loops while `503` is received.

---

## Planned Maintenance Window Runbook

Follow this checklist during scheduled maintenance windows (e.g., schema migrations, data backfills, infra updates).

### Phase 1: Pre-Maintenance Preparation (T-24h to T-1h)

1. Notify active clients and publish scheduled window details.
2. Confirm operator access with valid admin token or `ADMIN_API_KEY`.
3. Check system health and verify all queues and dead letters are in a clean state:
   ```sh
   curl -H "Authorization: Bearer ${ADMIN_TOKEN}" "https://api.hiresettle.com/api/v1/admin/metrics"
   ```

### Phase 2: Entering Maintenance Mode

1. Enable maintenance mode:
   ```sh
   curl -X PUT "https://api.hiresettle.com/api/v1/admin/maintenance-mode" \
     -H "Authorization: Bearer ${ADMIN_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'
   ```
2. Verify state returns `true`:
   ```sh
   curl -H "Authorization: Bearer ${ADMIN_TOKEN}" "https://api.hiresettle.com/api/v1/admin/maintenance-mode"
   ```
3. Test that read requests still work (`GET /api/v1/admin/users` returns `200`).
4. Test that write requests are blocked (a test mutation returns `503`).

### Phase 3: Executing Planned Maintenance

1. Perform required migrations or infrastructure updates.
2. Monitor background consumers and worker queues.

### Phase 4: Verification & Resuming Traffic

1. Perform administrative smoke tests.
2. Disable maintenance mode:
   ```sh
   curl -X PUT "https://api.hiresettle.com/api/v1/admin/maintenance-mode" \
     -H "Authorization: Bearer ${ADMIN_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"enabled": false}'
   ```
3. Confirm status returns `{"enabled": false}`.
4. Verify standard write operations succeed.
5. Notify stakeholders that maintenance is complete.
