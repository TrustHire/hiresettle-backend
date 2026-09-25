# GraphQL API

HireSettle exposes a read-only GraphQL layer alongside the primary REST API.
It is built with [NestJS GraphQL](https://docs.nestjs.com/graphql/quick-start)
using the **code-first** approach and served by Apollo Server.

---

## Endpoint

| Environment | URL |
|---|---|
| Local development | `http://localhost:3000/graphql` |
| Production | `https://api.hiresettle.com/graphql` |

The endpoint accepts `POST` requests with a JSON body containing `query`,
optional `variables`, and optional `operationName`.

---

## Authentication

The GraphQL endpoint **does not require authentication** in its current form.
There are no guards on `GraphqlModule` or `GraphqlResolver`. All five queries
are publicly accessible and return the same data visible to any authenticated
REST caller with read access.

> If you need to call the GraphQL API from a server-side context that already
> holds a JWT, you may pass it as a standard bearer token — it will be ignored
> by GraphQL today but is harmless and keeps your client future-proof:

```http
POST /graphql
Authorization: Bearer <your-jwt>
Content-Type: application/json
```

---

## Apollo Playground

The Apollo Playground (`playground: false`) is **disabled** in all
environments. Use one of the alternatives below to explore and test queries:

- **Swagger UI** – available at `http://localhost:3000/docs` in
  `development` mode for REST endpoints.
- **GraphiQL desktop apps** – [Insomnia](https://insomnia.rest/),
  [Altair](https://altairgraphql.dev/), or [Apollo Sandbox](https://studio.apollographql.com/sandbox).
- **Introspection** – introspection is enabled by default in development;
  point any GraphQL client at the endpoint to auto-discover the schema.

The generated schema file is written to `src/graphql/schema.gql` during build.

---

## Available queries

### `users`

Returns all registered users ordered by `createdAt` descending.

```graphql
query {
  users {
    id
    stellarAddress
    name
    company
    role
    verifiedAt
  }
}
```

**Arguments:** none.

**Returns:** `[GraphqlUser!]!`

---

### `user(stellarAddress: String!)`

Looks up a single user by their Stellar address.

```graphql
query GetUser($address: String!) {
  user(stellarAddress: $address) {
    id
    name
    role
    verifiedAt
  }
}
```

**Variables:**

```json
{ "address": "GABC...XYZ" }
```

**Returns:** `GraphqlUser` (nullable — `null` if no user exists for that address).

---

### `engagements(status, skip, take)`

Returns a paginated list of engagements with their nested participants and
milestones.

```graphql
query ListEngagements($status: EngagementStatus, $skip: Int, $take: Int) {
  engagements(status: $status, skip: $skip, take: $take) {
    id
    jobTitle
    totalAmount
    releasedAmount
    status
    company   { id name stellarAddress }
    recruiter { id name stellarAddress }
    arbiter   { id name stellarAddress }
    milestones {
      id
      milestoneIndex
      name
      kind
      paymentPercent
      amount
      status
    }
    createdAt
    updatedAt
  }
}
```

**Arguments:**

| Argument | Type | Default | Description |
|---|---|---|---|
| `status` | `EngagementStatus` (enum, nullable) | — | Filter by status. Omit to return all. |
| `skip` | `Int` (nullable) | `0` | Number of records to skip (offset pagination). |
| `take` | `Int` (nullable) | `20` | Maximum number of records to return. |

**`EngagementStatus` values:** `PENDING`, `ACTIVE`, `COMPLETED`, `CANCELLED`,
`DISPUTED`, `REPLACEMENT_REQUESTED`.

**Returns:** `[GraphqlEngagement!]!`

> **Note:** `totalAmount` and `releasedAmount` are serialised as `String`
> (not `Float`) to avoid floating-point precision loss with Stellar's 7
> decimal-place token amounts.

---

### `engagement(id: String!)`

Fetches a single engagement by its database ID.

```graphql
query GetEngagement($id: String!) {
  engagement(id: $id) {
    id
    jobTitle
    jobDescription
    salaryRange
    location
    totalAmount
    releasedAmount
    status
    tokenAddress
    companyAddress
    recruiterAddress
    arbiterAddress
    company   { id name }
    recruiter { id name }
    arbiter   { id name }
    milestones {
      id
      milestoneIndex
      name
      kind
      paymentPercent
      amount
      status
      proofHash
      confirmedAt
    }
    createdAt
    updatedAt
  }
}
```

**Variables:**

```json
{ "id": "clx1234567890" }
```

**Returns:** `GraphqlEngagement` (nullable — `null` if not found).

---

### `milestones(engagementId: String)`

Returns milestones, optionally scoped to one engagement.

```graphql
query GetMilestones($engagementId: String) {
  milestones(engagementId: $engagementId) {
    id
    milestoneIndex
    name
    kind
    paymentPercent
    amount
    status
    proofHash
    confirmedAt
  }
}
```

**Arguments:**

| Argument | Type | Default | Description |
|---|---|---|---|
| `engagementId` | `String` (nullable) | — | Scope results to one engagement. Omit to return all milestones across all engagements. |

**Returns:** `[GraphqlMilestone!]!` ordered by `engagementId ASC`,
`milestoneIndex ASC`.

---

## Types

### `GraphqlUser`

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `String` | no | Internal database ID. |
| `stellarAddress` | `String` | yes | User's Stellar public key. |
| `name` | `String` | yes | Display name. |
| `company` | `String` | yes | Company name. |
| `role` | `UserRole` | no | `ADMIN`, `COMPANY`, or `RECRUITER`. |
| `verifiedAt` | `DateTime` | yes | When the user's identity was verified. |

---

### `GraphqlEngagement`

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `String` | no | Internal database ID. |
| `companyAddress` | `String` | no | Stellar address of the hiring company. |
| `recruiterAddress` | `String` | no | Stellar address of the recruiter. |
| `arbiterAddress` | `String` | no | Stellar address of the arbiter. |
| `tokenAddress` | `String` | no | Contract address of the payment token. |
| `totalAmount` | `String` | no | Total escrow amount as a string. |
| `releasedAmount` | `String` | no | Amount released so far as a string. |
| `jobTitle` | `String` | no | Title of the role being recruited for. |
| `jobDescription` | `String` | yes | Full job description. |
| `salaryRange` | `String` | yes | Human-readable salary range. |
| `location` | `String` | yes | Job location. |
| `status` | `EngagementStatus` | no | Current lifecycle status. |
| `company` | `GraphqlUser` | no | Resolved hiring company user. |
| `recruiter` | `GraphqlUser` | no | Resolved recruiter user. |
| `arbiter` | `GraphqlUser` | no | Resolved arbiter user. |
| `milestones` | `[GraphqlMilestone]` | no | Ordered list of milestones. |
| `createdAt` | `DateTime` | no | Creation timestamp. |
| `updatedAt` | `DateTime` | no | Last update timestamp. |

---

### `GraphqlMilestone`

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `String` | no | Internal database ID. |
| `milestoneIndex` | `Int` | no | Zero-based position within the engagement. |
| `name` | `String` | no | Human-readable milestone label. |
| `kind` | `MilestoneKind` | no | `STANDARD` or `PLACEMENT` or `RETENTION`. |
| `paymentPercent` | `Int` | no | Percentage of `totalAmount` released at this milestone. |
| `amount` | `String` | yes | Computed token amount as a string. |
| `status` | `MilestoneStatus` | no | `PENDING`, `PROOF_SUBMITTED`, `CONFIRMED`, `DISPUTED`, `RELEASED`. |
| `proofHash` | `String` | yes | IPFS or content hash of proof submitted by recruiter. |
| `confirmedAt` | `DateTime` | yes | When the milestone was confirmed by the company. |

---

## REST features not yet available in GraphQL

The GraphQL layer is intentionally read-only and covers the core data
models. The following capabilities are **only available through the REST API**:

| Feature | REST endpoint |
|---|---|
| Creating / updating an engagement | `POST /api/v1/engagements` |
| Submitting milestone proof | `POST /api/v1/milestones/:id/proof` |
| Confirming / disputing a milestone | `POST /api/v1/milestones/:id/confirm` |
| Releasing a milestone payment | `POST /api/v1/milestones/:id/release` |
| User registration and authentication | `POST /api/v1/auth/*` |
| Notification management | `GET/PATCH /api/v1/notifications/*` |
| Webhook subscriptions | `POST /api/v1/webhooks/*` |
| Admin operations | `GET/POST/PATCH /api/v1/admin/*` |
| Billing and fee summaries | `GET /api/v1/billing/*` |
| On-chain event feed | `GET /api/v1/events` |
| Feature flag management | `GET/PUT /api/v1/admin/feature-flags/*` |

There are no GraphQL mutations in the current implementation.
