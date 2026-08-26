# Upgrade Guide

This document describes how breaking API changes are announced and how
consumers (the frontend, webhook subscribers, third-party integrators)
should migrate when one lands.

## How breaking changes are announced

- Every notable change is recorded in [`CHANGELOG.md`](../CHANGELOG.md),
  generated via [standard-version](https://github.com/conventional-changelog/standard-version)
  (`npm run release`) from
  [Conventional Commits](https://www.conventionalcommits.org/).
- A breaking change is a commit with a `BREAKING CHANGE:` footer (or a
  `!` after the type/scope, e.g. `feat(api)!: ...`), per the Conventional
  Commits spec. `standard-version` promotes these into their own
  **BREAKING CHANGES** section at the top of the changelog entry and bumps
  the **major** version.
- Because of this, **any consumer-facing breaking change must be committed
  with a `BREAKING CHANGE:` footer** so it is surfaced correctly — a plain
  `feat:`/`fix:` commit will not show up as breaking in the changelog even
  if it technically is one.
- The PR introducing the change should link the issue/PR and, where
  possible, note the affected endpoint(s) and the migration path in the PR
  description, in addition to the commit footer.

## Migration steps for consumers

When a new major version is released:

1. **Read the CHANGELOG** — check the `BREAKING CHANGES` section of the
   relevant version(s) between your currently integrated version and the
   target version. Breaking changes are cumulative across versions, so
   review every major version you're skipping over.
2. **Check the API surface** — cross-reference affected endpoints against
   the Swagger/OpenAPI docs (mounted at `/docs`, see
   [`README.md`](../README.md)) and [`docs/error-codes.md`](./error-codes.md)
   for any new/changed error responses.
3. **Update integration code** — adjust request/response shapes, field
   names, or auth flows per the migration notes in the changelog entry.
4. **Test against a non-production environment** first, using the same
   auth flow and payloads your integration uses in production.
5. **Watch webhooks** — if you consume webhooks, review
   [`docs/webhooks.md`](./webhooks.md) for any payload/signature changes
   accompanying the release; webhook payload shape changes are breaking
   changes and follow the same `BREAKING CHANGE:` convention.
6. **Roll out** and monitor error rates for your integration after
   switching over (see [`docs/monitoring.md`](./monitoring.md) if you have
   access to backend metrics, or your own client-side error tracking
   otherwise).

## Template for documenting a breaking change

Use this in the commit body/footer (for the changelog) **and** in the PR
description (for reviewers and consumers reading the PR directly):

```
BREAKING CHANGE: <one-line summary of what changed>

What changed:
- <endpoint/field/behavior before>
- <endpoint/field/behavior after>

Why:
<reason for the change>

Migration:
1. <step consumers need to take>
2. <step consumers need to take>

Affected endpoints:
- METHOD /path
```

Example commit message:

```
feat(engagements)!: require milestone kind on create

BREAKING CHANGE: POST /api/v1/engagements now requires a `kind` field
on every milestone; requests omitting it are rejected with 400.

What changed:
- Before: `milestones[].kind` was optional and defaulted to `FIXED`.
- After: `milestones[].kind` is required and must be `FIXED` or `RETENTION`.

Why:
Implicit defaulting was hiding a source of production bugs where retention
milestones were silently created as fixed milestones.

Migration:
1. Add an explicit `kind` field to every milestone object in existing
   integration code before upgrading.

Affected endpoints:
- POST /api/v1/engagements
```

## Non-breaking changes

Additive, backward-compatible changes (new optional fields, new endpoints,
new optional query parameters) are recorded under `Features`/`Bug Fixes` in
the changelog as usual and do not require a migration section — consumers
do not need to change anything to remain compatible.
