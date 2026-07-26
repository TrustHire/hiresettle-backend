# Production Deployment

This document describes how the HireSettle backend is built and deployed,
where each step is defined in the repo, and the required ordering of
database migrations relative to application startup.

## Overview

| Stage | What happens | Defined in |
| --- | --- | --- |
| CI (every push/PR) | Lint, type-check, migrate test DB, run tests | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| Image build (version tags) | Type-check, build Docker image, push to GHCR | [`.github/workflows/build.yml`](../.github/workflows/build.yml) |
| Container image | Install deps, compile NestJS to `dist/` | [`Dockerfile`](../Dockerfile) |
| Runtime (local compose) | Migrate DB, then start the API | [`docker-compose.yml`](../docker-compose.yml) |
| Runtime (production) | Migrate DB, then start the API (platform-specific) | See [Deploy steps](#deploy-steps) below |

Production deploys are driven by **semver tags** (`v*.*.*`). Pushing such a
tag triggers the Build & Push workflow, which publishes
`ghcr.io/<owner>/<repo>` with semver and SHA tags. The hosting platform
then pulls that image and runs it with the secrets listed in
[secrets.md](./secrets.md).

## Build artifacts

### Dockerfile

[`Dockerfile`](../Dockerfile) builds a Node 20 Alpine image:

1. `npm ci` — install locked dependencies
2. `npm run build` — compile TypeScript (`nest build` → `dist/`)
3. Default process: `node dist/main` on port `3000`

The image **does not** run Prisma migrations. Migrations must be applied
at deploy/runtime against the target database (see
[Migration ordering](#migration-ordering)).

### CI workflow

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every
push and pull request. Relevant steps for deploy confidence:

1. Install dependencies (`npm ci`)
2. `prisma generate`
3. Lint and type-check
4. `prisma migrate deploy` against the workflow’s Postgres service
5. Unit (and optionally integration) tests

CI validates that migrations apply cleanly; it does **not** publish an
image or update production.

### Build & push workflow

[`.github/workflows/build.yml`](../.github/workflows/build.yml) runs when a
`v*.*.*` tag is pushed:

1. Install dependencies and type-check
2. Log in to GitHub Container Registry (`ghcr.io`)
3. Build the image from the root [`Dockerfile`](../Dockerfile)
4. Push tags: full semver, `major.minor`, and commit SHA

## Deploy steps

Recommended production sequence:

1. **Ensure secrets are set** in the hosting platform’s secret store
   (Railway Variables, `fly secrets set`, AWS Secrets Manager, etc.).
   See [Required secrets](#required-secrets) and
   [docs/secrets.md](./secrets.md).
2. **Tag a release** (after CI is green on `main`):

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   This triggers image build and push to GHCR.
3. **Pull / roll out** the new image on the platform (automatic on some
   hosts, or via your usual release/rollout command).
4. **Apply migrations before the new app process serves traffic** — see
   [Migration ordering](#migration-ordering).
5. **Start (or replace) the app process** with `node dist/main` (the
   image `CMD`), with `NODE_ENV=production` and a reachable
   `DATABASE_URL`.
6. **Smoke-check** `GET /health` (and critical auth/API paths as needed).

Local parity with compose:

```bash
docker compose up --build
```

The compose `api` service already runs migrations then the server (see
below).

## Migration ordering

**Migrations must complete successfully before the application process
starts accepting traffic.**

| Context | Ordering | Where |
| --- | --- | --- |
| Docker Compose (local) | `npx prisma migrate deploy && node dist/main` | [`docker-compose.yml`](../docker-compose.yml) `api.command` |
| CI test job | `prisma migrate deploy`, then Jest | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| Production image (`Dockerfile` `CMD`) | **App only** (`node dist/main`) — no migrate | [`Dockerfile`](../Dockerfile) |

Because the production image entrypoint does not migrate, the deploy
environment must either:

- Use a **release command / pre-start hook** that runs
  `npx prisma migrate deploy` (or `./node_modules/.bin/prisma migrate deploy`)
  against production `DATABASE_URL` **before** new containers become
  the primary process, **or**
- Override the container command the same way compose does:

  ```bash
  npx prisma migrate deploy && node dist/main
  ```

Do **not** start multiple new app instances against a schema that has
not been migrated yet. Prefer a single migrate step (one-off job or
pre-deploy command), then roll out app instances.

`prisma migrate deploy` applies pending migrations from `prisma/migrations`
only — it does not create new migration files. Create those in development
with `prisma migrate dev` and commit them before tagging a release.

## Required secrets

At deploy time the process must receive the secrets (and other required
env vars) via the platform — never baked into the image or committed to
git. Full inventory, rotation, and injection for Railway / Fly.io / ECS
are documented in **[docs/secrets.md](./secrets.md)**.

Secrets that must be present in the deploy environment:

| Secret | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs/verifies access & refresh tokens (min 32 chars, entropy-checked at startup) |
| `DATABASE_URL` | PostgreSQL connection string (used by the app and by `prisma migrate deploy`) |
| `SMTP_PASS` | Outbound email authentication |
| `STELLAR_SECRET_KEY` | Read-only Stellar key for event polling |
| `S3_SECRET_ACCESS_KEY` | Object storage authentication |

Also set non-secret but required configuration for production (see
`.env.example` and the README env table), including at least:
`STELLAR_NETWORK`, `STELLAR_RPC_URL`, `HIRESETTLE_CONTRACT_ID`,
`ALLOWED_TOKENS`, `SMTP_HOST`, `SMTP_USER`, `S3_ACCESS_KEY_ID`,
`S3_REGION`, and `S3_BUCKET`.

## Related docs

- [Secret management & rotation](./secrets.md)
- [On-call runbook](./runbook.md)
- [Architecture](./architecture.md)
- [Security](./security.md)
