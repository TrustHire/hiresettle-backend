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

## Verifying the signature on your server

Use the following steps on your webhook receiver to confirm each delivery
actually came from HireSettle and was not tampered with in transit.

**Header name:** `X-HireSettle-Signature`  
**Algorithm:** HMAC-SHA256, hex-encoded

### Step-by-step

1. Read the raw request body **before** parsing it. Any re-serialisation
   (e.g. `JSON.stringify(req.body)`) will produce a different byte sequence
   and break the comparison.
2. Compute `HMAC-SHA256(webhookSecret, rawBody)` using the signing secret you
   received when you first set your `webhookUrl`.
3. Compare the result to the `X-HireSettle-Signature` header value using a
   **constant-time** equality function to prevent timing attacks.
4. Reject the request with `401` if the values do not match.

### Code samples

**Node.js (Express)**
```js
const crypto = require('crypto');

// Use express.raw() (or similar) so req.body is a Buffer, not a parsed object.
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hiresettle-signature'];
  const secret    = process.env.HIRESETTLE_WEBHOOK_SECRET;

  if (!isValidSignature(req.body, signature, secret)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());
  // Handle event...
  res.sendStatus(200);
});

function isValidSignature(rawBody, signatureHeader, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Both buffers must have the same length for timingSafeEqual
  if (expected.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  );
}
```

**Python (Flask)**
```python
import hashlib, hmac
from flask import Flask, request, abort

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-HireSettle-Signature', '')
    secret    = os.environ['HIRESETTLE_WEBHOOK_SECRET'].encode()
    raw_body  = request.get_data()  # raw bytes, before any parsing

    expected = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        abort(401)

    event = request.get_json()
    # Handle event...
    return '', 200
```

**Go**
```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "io"
    "net/http"
    "os"
)

func webhookHandler(w http.ResponseWriter, r *http.Request) {
    rawBody, _ := io.ReadAll(r.Body)
    signature  := r.Header.Get("X-HireSettle-Signature")
    secret     := []byte(os.Getenv("HIRESETTLE_WEBHOOK_SECRET"))

    mac := hmac.New(sha256.New, secret)
    mac.Write(rawBody)
    expected := hex.EncodeToString(mac.Sum(nil))

    if !hmac.Equal([]byte(expected), []byte(signature)) {
        http.Error(w, "Invalid signature", http.StatusUnauthorized)
        return
    }
    // Handle event...
    w.WriteHeader(http.StatusOK)
}
```

> **Tip:** Always validate the signature before deserialising the body. Parsing
> untrusted JSON before verifying authenticity can expose your server to
> denial-of-service or prototype-pollution attacks.

## Retries

Failed deliveries are retried on an exponential backoff schedule (up to 3
attempts). If all attempts are exhausted, the failure is recorded rather than
silently dropped, and an admin can trigger a manual resend via
`POST /admin/webhooks/deliveries/:id/resend`.
