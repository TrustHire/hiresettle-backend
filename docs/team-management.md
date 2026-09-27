# Team Management

This guide covers how a company manages its members: sending invites, accepting them, the permissions attached to each `CompanyRole`, and removing members.

All endpoints below require authentication. Unless noted otherwise, the caller must be a member of the company with sufficient role permissions (see the [role table](#role-permissions)).

## Invite → Accept Sequence

### 1. Send an invite

A company admin (or owner) invites a user by email. The invite is created via the team-invites module.

```http
POST /companies/:companyId/invites
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "email": "newhire@example.com",
  "role": "MEMBER"
}
```

Response:

```json
{
  "id": "inv_01H...",
  "companyId": "cmp_01H...",
  "email": "newhire@example.com",
  "role": "MEMBER",
  "status": "PENDING",
  "expiresAt": "2024-06-01T00:00:00.000Z",
  "createdAt": "2024-05-25T00:00:00.000Z"
}
```

The invited user receives an email containing the invite token. Invites expire after the configured window; an expired invite must be re-sent.

### 2. List pending invites

```http
GET /companies/:companyId/invites
Authorization: Bearer <access_token>
```

Returns all invites for the company, including their `status` (`PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`).

### 3. Accept the invite

The invited user accepts using the token from the email. The caller must be authenticated as the user matching the invite email.

```http
POST /invites/:token/accept
Authorization: Bearer <access_token>
```

On success, a `CompanyMember` record is created linking the user to the company with the invite's role, and the invite `status` becomes `ACCEPTED`:

```json
{
  "id": "mem_01H...",
  "companyId": "cmp_01H...",
  "userId": "usr_01H...",
  "role": "MEMBER",
  "createdAt": "2024-05-26T00:00:00.000Z"
}
```

### 4. Revoke an invite (optional)

An admin can revoke a still-pending invite before it is accepted:

```http
DELETE /companies/:companyId/invites/:inviteId
Authorization: Bearer <access_token>
```

## Role Permissions

Each `CompanyMember` has exactly one `CompanyRole`. Permissions are cumulative — a higher role includes everything the roles below it can do.

| Capability | `OWNER` | `ADMIN` | `MEMBER` |
|------------|:-------:|:-------:|:--------:|
| View company details and members | ✅ | ✅ | ✅ |
| View engagements and milestones | ✅ | ✅ | ✅ |
| Create and manage engagements | ✅ | ✅ | ❌ |
| Invite members | ✅ | ✅ | ❌ |
| Change a member's role | ✅ | ✅ | ❌ |
| Remove members | ✅ | ✅ | ❌ |
| Manage billing and payment methods | ✅ | ❌ | ❌ |
| Update company settings | ✅ | ✅ | ❌ |
| Transfer ownership / delete company | ✅ | ❌ | ❌ |

Notes:

- A company must always have at least one `OWNER`; ownership can only be transferred to an existing member.
- `ADMIN` cannot modify or remove an `OWNER`.
- Members cannot change their own role.

## Change a Member's Role

```http
PATCH /companies/:companyId/members/:memberId
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "role": "ADMIN"
}
```

Only `OWNER` and `ADMIN` callers may change roles, and only within the limits described above.

## Remove a Member

An `OWNER` or `ADMIN` removes a member by deleting the `CompanyMember` record:

```http
DELETE /companies/:companyId/members/:memberId
Authorization: Bearer <access_token>
```

A successful removal returns `204 No Content`. The user loses access to the company immediately; any pending invites they sent remain valid unless separately revoked.

Constraints:

- You cannot remove the last `OWNER` of a company.
- An `ADMIN` cannot remove an `OWNER`.
- To remove yourself, use the same endpoint with your own `memberId` (subject to the constraints above).
