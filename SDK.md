# TypeScript SDK

The HireSettle API provides a type-safe TypeScript SDK generated from the OpenAPI specification.

## Generating the SDK

Run the generation script from the project root:

```bash
npm run generate:client
```

This produces a fully-typed SDK in `src/client/` using axios for HTTP requests.

## SDK Structure

The generated client includes:

- **`api.ts`** — Type-safe API methods for all endpoints (e.g., `getEngagement`, `createMilestone`, `listEvents`)
- **`configuration.ts`** — Client configuration (base URL, headers, axios instance)
- **`apis` and `models` subdirectories** — Separated by OpenAPI tags (engagements, milestones, events, notifications, auth, health)
- **`index.ts`** — Barrel exports for easy imports

## Using the SDK

```typescript
import { HireSettleClient } from './client';

const client = new HireSettleClient({
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000/api/v1',
  apiKey: process.env.API_KEY,
});

// Get an engagement
const engagement = await client.engagements.getEngagement({ id: '123' });

// Create a milestone proof
const proof = await client.milestones.createMilestoneProof({
  id: '456',
  milestoneId: '789',
  request: { /* proof data */ },
});

// List events
const events = await client.events.listEvents({ limit: 50 });
```

## CI/CD

The SDK is regenerated on every push and PR:

1. `generate:openapi` builds the OpenAPI spec from the current NestJS routes
2. `generate:client` produces the TypeScript SDK
3. The SDK is uploaded as a CI artifact named `typescript-sdk` (retained for 30 days)

## Manual Regeneration

If you need to regenerate the SDK locally:

```bash
# Regenerate OpenAPI spec (requires running Postgres)
npm run generate:openapi

# Generate TypeScript SDK
npm run generate:client
```

## SDK Generation Tool

This project uses **[@hey-api/openapi-ts](https://heyapi.dev/)** to generate the client from the OpenAPI spec.
