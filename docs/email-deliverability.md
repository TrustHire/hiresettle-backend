# Email Deliverability

This document explains how the backend handles email bounces and complaints, how
suppressed addresses are tracked, how admins can lift a suppression, and how
`List-Unsubscribe` headers are emitted.

## Bounces and complaints

Transactional email is sent through the configured email provider. The provider
reports delivery problems back to the backend via a webhook that is handled by
the **bounce controller** (`BounceController`).

1. The provider POSTs a webhook event (bounce, complaint, or delivery) to the
   bounce controller endpoint.
2. The controller verifies the request signature/secret before processing.
3. The event is normalised into a bounce record: the recipient address, the
   bounce type (hard/soft), and the reason reported by the provider.
4. Hard bounces and spam complaints cause the recipient address to be added to
   the suppression list (see below). Soft bounces are recorded but do not
   suppress the address.

Because suppression happens at the point the webhook is processed, an address
that hard-bounced or complained is never retried by the application.

## The `SuppressedEmail` model

Suppressed addresses are stored in the `SuppressedEmail` model. Each row records:

| Field | Meaning |
|-------|---------|
| `email` | The normalised (lower-cased) recipient address. Unique. |
| `reason` | Why the address was suppressed. |
| `createdAt` | When the suppression was recorded. |

### Suppression reasons

- **`BOUNCE`** — the provider reported a hard bounce for the address.
- **`COMPLAINT`** — the recipient marked a message as spam.
- **`MANUAL`** — an admin suppressed the address explicitly.

Before any outbound email is sent, the address is checked against
`SuppressedEmail`; if a matching row exists the send is skipped.

## Removing an address from suppression

Admins can lift a suppression when an address has been fixed (for example, a
mailbox that was temporarily full or a corrected address).

- Use the admin endpoint exposed by the bounce controller to delete the
  `SuppressedEmail` row for the address.
- The endpoint requires the admin role; non-admin callers receive `403`.
- After the row is removed, the address is eligible to receive email again on
  the next send.

Only remove a suppression after confirming the underlying problem is resolved —
re-sending to an address that still hard-bounces will simply re-suppress it.

## `List-Unsubscribe` behaviour

Outbound marketing/notification emails include a `List-Unsubscribe` header so
recipients can opt out directly from their mail client.

- The header advertises both a `mailto:` unsubscribe address and an HTTPS
  one-click unsubscribe URL (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
- A one-click unsubscribe request records the recipient in `SuppressedEmail`
  with reason `COMPLAINT`, so no further email is sent to that address.
- The unsubscribe link is generated per recipient and does not require login.

## Related documentation

- [Notifications Guide](./notifications-guide.md) — how email notifications are
  delivered and configured.
- [Admin Guide](./admin-guide.md) — admin-only endpoints and role requirements.
- [Database Schema](./database-schema.md) — model overview including
  `SuppressedEmail`.
