# Outgoing Webhooks

HireSettle delivers event notifications (`COMPLETED`, `CANCELLED`,
`REPLACEMENT_REQUESTED`, `DISPUTE_RAISED`, `PAYMENT_RELEASED`) to the
`webhookUrl` configured on a company's profile (`PATCH /auth/me`).

## Signature verification

Every outgoing webhook request includes an `X-HireSettle-Signature` header:

```
X-HireSettle-Signature: <hex-encoded HMAC-SHA256 of the raw request body>
```

The signature is computed as:

```
signature = HMAC-SHA256(secret, raw_request_body)
```

where `raw_request_body` is the exact, unmodified JSON body bytes sent in the
request (compute the HMAC before any parsing/re-serialization on your end, or
the signature will not match).

To verify a delivery, recompute the HMAC over the raw body using your
subscription secret and compare it to the header value using a
constant-time comparison:

```js
const crypto = require('crypto');

function isValidSignature(rawBody, signatureHeader, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

## Getting your signing secret

The secret is generated automatically the first time you set a `webhookUrl`
via `PATCH /auth/me`, and is returned **once**, in that response's
`webhookSecret` field. It is not stored anywhere retrievable afterwards — if
you lose it, set `webhookUrl` again (e.g. to the same value) to receive a
newly rotated secret.

## Retries

Failed deliveries are retried on an exponential backoff schedule (up to 3
attempts). If all attempts are exhausted, the failure is recorded rather than
silently dropped, and an admin can trigger a manual resend via
`POST /admin/webhooks/deliveries/:id/resend`.
