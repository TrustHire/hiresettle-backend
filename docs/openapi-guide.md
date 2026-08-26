# OpenAPI and Swagger guide

Swagger UI is available at `/docs` and its generated OpenAPI document at
`/docs-json` when the application is not running in production. Keep the
NestJS decorators next to the controller and DTO code they describe, so the
published document changes with the API.

## Conventions for a new endpoint

On the controller, add or update:

- `@ApiTags()` to group a controller's operations.
- `@ApiOperation({ summary: ... })` on every handler, using a short,
  user-facing description.
- `@ApiBearerAuth()` wherever the handler or controller requires JWT
  authentication.
- `@ApiBody({ type: RequestDto })` when the handler accepts a request body,
      using the same DTO passed to `@Body()`.
- `@ApiParam()` for path parameters and `@ApiQuery()` for optional or
  non-obvious query parameters.
- `@ApiConsumes()` for multipart endpoints.
- `@ApiResponse()` for the success response and each expected error response.
  At a minimum, document `401` on authenticated routes, `403` for role- or
  ownership-restricted routes, and validation or not-found responses that the
  handler can return. Include `type` when a concrete response DTO exists.

For every request DTO property, use `@ApiProperty()` when required and
`@ApiPropertyOptional()` when optional. Keep its `required`, `enum`, `type`,
`description`, and representative `example` aligned with the TypeScript type
and the `class-validator` decorators. Use `type: [ItemDto]` for nested arrays;
use `enum` for constrained values. Response DTOs should annotate fields in the
same way when they are used as an `@ApiResponse({ type: ... })` schema.

Decorators describe the public contract; they do not replace runtime validation
or authorization. Keep the matching `class-validator` and guard/role metadata
on the endpoint.

## PR review checklist

- [ ] The method, path, tags, summary, request body, path parameters, and query
      parameters match the controller.
- [ ] Every DTO field has accurate required/optional status, type, enum,
      description, and example.
- [ ] Success and expected error responses are documented, including `401` and
      applicable `403` responses.
- [ ] Authentication and role restrictions are represented with
      `@ApiBearerAuth()` and clear operation text.
- [ ] Multipart content types and response DTO schemas are declared where used.
- [ ] `/docs` and `/docs-json` were checked locally in a non-production
      environment after the change.
