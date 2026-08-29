# API Versioning

This document defines the URL versioning convention for the HireSettle HTTP
API and the policy for retiring an older version.

## Current Version

The current public API is version 1 and is served under:

```text
/api/v1
```

The prefix is applied globally by the NestJS application. It is controlled by
the `API_PREFIX` environment variable, whose default value is `api/v1`:

```text
API_PREFIX=api/v1
```

For example, an endpoint exposed as `/engagements` by its controller is
available at `/api/v1/engagements` in the default deployment. The OpenAPI
document uses the same prefix as its base path.

The following operational endpoints are deliberately outside the versioned
prefix:

- `GET /health`
- `GET /docs` (non-production only)
- `GET /docs-json` (non-production only)
- `GET /metrics`

Changing `API_PREFIX` changes the route prefix for the application. It is a
deployment setting, not a mechanism for serving two API versions at once.
Production deployments should use the default `api/v1` value unless a
deliberate infrastructure migration requires otherwise.

## What Requires a New Version

Backward-compatible additions remain in the current version. Examples include
new endpoints, optional request fields, and new response fields that clients
can ignore.

Breaking changes require a new major URL version, such as `/api/v2`. Examples
include removing or renaming an endpoint or field, changing the meaning or
type of an existing field, changing authentication requirements, and changing
error or pagination behavior in a way that can break existing clients.

The version number is part of the URL and is not negotiated through a request
header. A new version must have its own OpenAPI document, release notes, and
migration guide. During the migration period, `/api/v1` and `/api/v2` must be
served in parallel; changing `API_PREFIX` alone does not satisfy this
requirement.

## Deprecation and Sunset Policy

When a new version becomes generally available:

1. The previous version remains supported for at least 12 months from the new
   version's general availability date.
2. The deprecation announcement must identify the replacement version, list
   the breaking changes, link to migration guidance, and state the planned
   sunset date.
3. The deprecation announcement must be published at least 90 days before the
   sunset date and recorded in the changelog and API documentation.
4. During the deprecation period, the older version receives bug fixes and
   security fixes, but no new features. New endpoints and capabilities target
   the newer version.
5. At sunset, the older version may be removed or return a documented
   deprecation response. The replacement version must already be available and
   its documentation must remain accessible.

The 12-month period is a minimum, not an automatic promise to keep a version
indefinitely. A longer period may be announced when client migration requires
it. Security or regulatory issues may require an earlier change; such an
exception must be explicitly communicated with its effective date and
mitigation guidance.

The API implementation should return standard `Deprecation` and `Sunset`
headers for deprecated routes once that middleware is introduced. Until then,
the changelog and published API documentation are the authoritative source
for deprecation status and dates.