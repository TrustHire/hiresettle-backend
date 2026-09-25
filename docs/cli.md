# Admin CLI

`src/cli/admin.ts` is a thin Node.js script that wraps the HireSettle admin
REST API. It is the fastest way to perform common admin operations from a
terminal without opening the Swagger UI.

---

## Required environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_API_KEY` | **yes** | — | API key whose owner has the `ADMIN` role. |
| `ADMIN_API_URL` | no | `http://localhost:3000/api/v1` | Base URL of the HireSettle API. |

The script reads both variables from `process.env`. It will exit with code `1`
and print an error if `ADMIN_API_KEY` is missing.

---

## How to run

### Locally

```sh
ADMIN_API_KEY=hs_... npm run admin:cli -- <command>
```

`npm run admin:cli` resolves to:

```sh
ts-node --project tsconfig.json src/cli/admin.ts
```

so the TypeScript source is compiled on the fly — no build step required.

### In production / CI

Compile the project first, then run the compiled output directly:

```sh
# Build once
npm run build

# Run compiled CLI
ADMIN_API_KEY=hs_... \
ADMIN_API_URL=https://api.hiresettle.com/api/v1 \
node dist/cli/admin.js <command>
```

---

## Commands

### `user lookup <query>`

Searches users by email, name, or Stellar address.

**Usage:**

```sh
ADMIN_API_KEY=hs_... npm run admin:cli -- user lookup user@example.com
```

**What it does:**

Sends `GET /admin/users?search=<query>&limit=100` and prints the matching
user records as formatted JSON.

**Example output:**

```json
[
  {
    "id": "clx1234567890",
    "email": "user@example.com",
    "name": "Alice Recruiter",
    "role": "RECRUITER",
    "stellarAddress": "GABC...XYZ",
    "verifiedAt": "2026-06-01T10:00:00.000Z",
    "deactivatedAt": null
  }
]
```

**Arguments:**

| Argument | Description |
|---|---|
| `query` | Email, name fragment, or Stellar address to search for. |

---

### `webhook resend <delivery-id>`

Retriggers a failed webhook delivery.

**Usage:**

```sh
ADMIN_API_KEY=hs_... npm run admin:cli -- webhook resend clx9876543210
```

**What it does:**

Sends `POST /admin/webhooks/deliveries/<delivery-id>/resend` and prints the
API response. The delivery ID can be found by querying the admin panel or
from the `webhook_deliveries` table.

**Example output:**

```json
{
  "message": "Webhook delivery clx9876543210 requeued successfully."
}
```

**Arguments:**

| Argument | Description |
|---|---|
| `delivery-id` | The UUID of the `WebhookDelivery` row to resend. |

---

## Error handling

The CLI exits with code `1` and prints a human-readable message to `stderr`
in the following cases:

| Scenario | Output |
|---|---|
| `ADMIN_API_KEY` not set | `ADMIN_API_KEY is required` |
| Unrecognised command | `Usage: npm run admin:cli -- <user lookup QUERY\|webhook resend DELIVERY_ID>` |
| API returned an error response | `Admin API request failed: <message from API>` |
| Any other unexpected error | The error's message string |

Successful output is written to `stdout` as pretty-printed JSON so it can be
piped to tools like `jq`:

```sh
ADMIN_API_KEY=hs_... npm run admin:cli -- user lookup alice | jq '.[0].id'
```

---

## Adding a new command

1. Open `src/cli/admin.ts`.
2. Add a new `if` branch inside the `run()` function following the existing
   pattern:

```ts
if (resource === 'engagement' && action === 'cancel' && identifier) {
  const response = await client.post(
    `/admin/engagements/${encodeURIComponent(identifier)}/cancel`,
  );
  return response.data?.data ?? response.data;
}
```

3. Update the usage string in the final `throw new Error(...)` to document
   the new command.
4. Add an entry to the [Commands](#commands) section of this document.
