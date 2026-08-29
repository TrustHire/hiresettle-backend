# Coding Standards

Conventions for code style, module structure, and NestJS patterns used across the HireSettle backend.

---

## Linting and formatting

| Tool | Command | Config |
|------|---------|--------|
| ESLint | `npm run lint` | `.eslintrc.js` |
| Prettier | `npm run format` | Prettier defaults (no `.prettierrc`) |

Both tools run automatically on staged files via Husky pre-commit hooks. Do not skip hooks (`--no-verify`).

### ESLint rules in effect

The project extends `plugin:@typescript-eslint/recommended` and `plugin:prettier/recommended`. Notable overrides:

| Rule | Level | Reason |
|------|-------|--------|
| `@typescript-eslint/no-explicit-any` | `off` | Permitted but discouraged — prefer typed alternatives |
| `@typescript-eslint/no-unused-vars` | `warn` | Remove unused variables before merging |
| `@typescript-eslint/explicit-function-return-type` | `off` | Inferred return types are acceptable |
| `@typescript-eslint/interface-name-prefix` | `off` | No `I` prefix required on interfaces |

---

## Module folder structure

Each feature module lives under `src/modules/<module-name>/` and follows this layout:

```
src/modules/engagements/
├── engagements.module.ts       # @Module decorator, imports, providers, exports
├── engagements.controller.ts   # Route handlers, guards, Swagger decorators
├── engagements.service.ts      # Business logic
├── engagements.service.spec.ts # Unit tests for the service
└── dto/
    ├── create-engagement.dto.ts
    ├── update-engagement-status.dto.ts
    └── engagement-summary.dto.ts
```

Shared utilities (guards, interceptors, decorators, Prisma client) live under `src/common/`.

---

## Naming conventions

### Files

| Artifact | Pattern | Example |
|----------|---------|---------|
| Module | `<name>.module.ts` | `engagements.module.ts` |
| Controller | `<name>.controller.ts` | `engagements.controller.ts` |
| Service | `<name>.service.ts` | `engagements.service.ts` |
| Unit test | `<name>.service.spec.ts` | `engagements.service.spec.ts` |
| Guard | `<name>.guard.ts` | `roles.guard.ts` |
| Interceptor | `<name>.interceptor.ts` | `idempotency.interceptor.ts` |
| Decorator | `<name>.decorator.ts` | `current-user.decorator.ts` |
| DTO (input) | `<verb>-<noun>.dto.ts` | `create-engagement.dto.ts` |
| DTO (response) | `<noun>-response.dto.ts` | `audit-log-response.dto.ts` |

All file names use **kebab-case**.

### Classes and DTOs

| Artifact | Pattern | Example |
|----------|---------|---------|
| Module class | `<Name>Module` | `EngagementsModule` |
| Controller class | `<Name>Controller` | `EngagementsController` |
| Service class | `<Name>Service` | `EngagementsService` |
| Input DTO | `<Verb><Noun>Dto` | `CreateEngagementDto` |
| Response DTO | `<Noun>ResponseDto` | `AuditLogEntryDto` |

All class names use **PascalCase**.

---

## DTO conventions

DTOs use `class-validator` decorators for validation and `@nestjs/swagger` decorators for OpenAPI documentation. Always pair them:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateEngagementDto {
  @ApiProperty({ example: 'Senior Engineer role' })
  @IsString()
  @IsNotEmpty()
  title: string;
}
```

- Use `@ApiPropertyOptional` (not `@ApiProperty({ required: false })`) for optional fields.
- Use `@IsOptional()` before other validators on optional fields.
- Do not use `class-transformer`'s `@Expose()` — DTOs are plain classes, not serialization-mapped instances.

---

## NestJS patterns

### Guards

Authentication uses `JwtOrApiKeyGuard` (accepts either a bearer token or an `x-api-key` header). Apply role restrictions with `@Roles()` + `RolesGuard`:

```typescript
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

### Accessing the current user

Use the `@CurrentUser()` decorator — it extracts the validated `User` object from the request:

```typescript
@Get('me')
getProfile(@CurrentUser() user: User) { ... }
```

### Idempotency

Mutating endpoints that must be idempotent apply `IdempotencyInterceptor` via `@UseInterceptors` and mark the handler with `@Idempotent()`. The client supplies an `Idempotency-Key` header.

### Throttling

Per-endpoint rate limits override the global default with `@Throttle({ default: { limit, ttl } })`. See `docs/rate-limiting.md` for the global defaults.

### Swagger

Every controller carries `@ApiTags('<module>')` and `@ApiBearerAuth()`. Every route handler has `@ApiOperation` and at least one `@ApiResponse`. Keep decorators next to the route definition they describe.
