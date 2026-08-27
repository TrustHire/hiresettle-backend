# Administrator guide

Administrator routes require an authenticated bearer token whose `role` claim is
`ADMIN` (`UserRole.ADMIN`). API routes below include the configured API prefix
(by default, `/api/v1`).

## Admin-only endpoints

| Method | Path | Purpose | Required role |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/users` | List and search users. | `ADMIN` |
| `DELETE` | `/api/v1/admin/users/:id` | Soft-deactivate a user. | `ADMIN` |
| `POST` | `/api/v1/admin/users/:id/reactivate` | Reactivate a deactivated user. | `ADMIN` |
| `PATCH` | `/api/v1/admin/engagements/:id/arbiter` | Assign or reassign an engagement arbiter. | `ADMIN` |
| `GET` | `/api/v1/admin/arbiters` | List active arbiters. | `ADMIN` |
| `GET` | `/api/v1/admin/metrics` | Retrieve cached platform dashboard metrics. | `ADMIN` |
| `GET` | `/api/v1/admin/dead-letter-events` | List event-processing failures held in the dead-letter queue. | `ADMIN` |
| `POST` | `/api/v1/admin/dead-letter-events/:id/requeue` | Return a dead-letter event to the processing queue for retry. | `ADMIN` |
| `POST` | `/api/v1/admin/cache/flush` | Flush application cache entries. | `ADMIN` |
| `GET` | `/api/v1/events` | List indexed on-chain events, with optional filters. | `ADMIN` |
| `POST` | `/api/v1/events/process-unprocessed` | Trigger processing for unprocessed chain events. | `ADMIN` |
| `PATCH` | `/api/v1/engagements/:id/status` | Force an engagement status update; an audit-log record is written with the administrator and reason. | `ADMIN` |
| `PATCH` | `/api/v1/engagements/:engagementId/milestones/:index/status` | Force a milestone status update; an audit-log record is written with the administrator and reason. | `ADMIN` |

Audit logs are created by the two status-override operations. The application
does not currently expose a separate audit-log read endpoint.

## How access is enforced

`JwtAuthGuard` authenticates the bearer token and places the user on the
request. `RolesGuard` then reads the `@Roles(UserRole.ADMIN)` metadata and
returns `403 Forbidden` when the token role is not `ADMIN`. The `/admin` and
`/events` controllers declare this metadata at class level. The engagement and
milestone status overrides declare both `@UseGuards(RolesGuard)` and
`@Roles(UserRole.ADMIN)` on their individual handlers.

Authentication failures return `401 Unauthorized`. Do not rely on a Swagger
summary such as "admin only" for authorization: the guards and `@Roles` metadata
are the source of enforcement.
