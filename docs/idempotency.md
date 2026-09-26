# Idempotent requests

HireSettle supports idempotency keys on selected write endpoints. An idempotency
key lets a client safely retry a request after a timeout or interrupted
connection without creating the same resource twice.

## Sending a key

Send a client-generated, unique value in the `Idempotency-Key` header alongside
the usual authentication header:

```http
POST /api/v1/engagements HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: 7b4c675d-6a6c-4f76-9b35-923ea4911f42

{
  "jobTitle": "Senior Engineer"
}
```

UUIDs are recommended because they are easy to generate and unlikely to
collide. Keys are scoped to the authenticated user, so different users may use
the same value without sharing a cached response. Requests without the header
are processed normally.

## Retry behavior

The first successful request is processed normally and its response is cached
for 24 hours. A retry by the same user with the same key during that period
returns the cached response without running the endpoint again. After the key
expires, the next request is processed as a new request and refreshes the
24-hour expiry.

Only completed handler responses are cached. If the original request fails
before producing a response, retry it with the same key.

Keys are currently associated with only the authenticated user, not with a
request path or body. If a key is reused with a different body or on another
supported endpoint during its 24-hour lifetime, the API returns the response
cached for the first request; it does not process the new body or return a
conflict error. Generate a new key for every distinct operation.

## Supported endpoints

The following routes honor `Idempotency-Key`. The `/api/v1` prefix shown here
is the default and may differ in deployments that configure `API_PREFIX`.

| Method | Endpoint | Operation |
| --- | --- | --- |
| `POST` | `/api/v1/engagements` | Create an engagement |
| `POST` | `/api/v1/engagement-templates` | Create an engagement template |
| `POST` | `/api/v1/engagement-templates/:id/clone` | Clone an engagement template |
| `POST` | `/api/v1/engagement-templates/:id/adopt` | Adopt a public engagement template |
| `POST` | `/api/v1/engagements/:engagementId/milestones/bulk` | Create milestones in bulk |
| `POST` | `/api/v1/engagements/:engagementId/milestones/:index/resolve` | Resolve a milestone dispute |
| `POST` | `/api/v1/webhooks/subscriptions` | Create a webhook subscription |

Other endpoints ignore the header.

## Client retry pattern

1. Generate one key before the first attempt.
2. Persist the key with the pending operation on the client.
3. Retry transient network failures with the same key and unchanged request.
4. Stop reusing the key after a response is received.
5. Generate a new key when the request body or intended operation changes.

