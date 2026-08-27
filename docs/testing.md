# Testing

HireSettle uses a testing pyramid: most behavior belongs in fast unit tests, important application flows are covered by integration tests, and end-to-end tests are reserved for complete user journeys.

## Layout and conventions

- `src/**/*.spec.ts` contains unit tests. Keep a spec next to the class it tests, use `describe` for the class or method, and name cases after observable behavior.
- `src/integration/**/*.integration.spec.ts` contains integration tests. These boot the real `AppModule`, exercise HTTP endpoints with `supertest`, and use a Postgres test database.
- `test/load/` contains k6 load scenarios such as `engagement-create.js`, `engagement-list.js`, and `notification-stream.js`. These are performance tests, not Jest tests.
- There is currently no separate e2e suite or npm script. When a full-system journey needs coverage, follow the integration setup and keep it in `src/integration/` so it runs with the integration command.

Unit specs should be deterministic and isolated from the network, database, queues, and filesystem. Integration specs may use real infrastructure, but must clean up their data and close the Nest application in teardown. Keep load tests focused on latency, throughput, and error-rate thresholds rather than business assertions.

## Running tests

```bash
# All Jest tests
npm test

# Watch mode
npm run test:watch

# One unit test file
npm test -- auth.service.spec.ts --runInBand

# One integration test file (requires a migrated Postgres test database)
npx jest integration/auth.integration.spec.ts --runInBand --forceExit

# Unit tests with coverage
npm run test:cov
```

Integration tests require `TEST_DATABASE_URL` or `DATABASE_URL` and a database with migrations applied. The CI workflow starts Postgres, sets `DATABASE_URL`, runs `prisma migrate deploy`, and then runs the tests. Do not point integration tests at a development or production database.

## Unit-test setup and mocks

Create a Nest `TestingModule` and replace infrastructure providers with `useValue` mocks. Mock only the methods the class under test calls, and reset the mocks in `beforeEach`.

```ts
const prisma = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};
const stellar = { accountExists: jest.fn() };

const module = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: PrismaService, useValue: prisma },
    { provide: StellarService, useValue: stellar },
  ],
}).compile();
```

`PrismaService` mocks should mirror the Prisma model and method used by the service, for example `prisma.user.findUnique.mockResolvedValue(user)`. For `$transaction`, invoke callback transactions with the mock Prisma object and return `Promise.all` for array transactions when the code under test uses both forms.

`StellarService` mocks should stub the specific chain operation being tested, for example `accountExists.mockResolvedValue(true)` or `submitTransaction.mockRejectedValue(error)`. Do not contact Stellar from a unit test. Test success, rejected calls, and any fallback or retry behavior explicitly.

## Coverage

Jest collects coverage from TypeScript and JavaScript files under `src/` and writes the report to `coverage/`. The global minimums are:

| Metric | Minimum |
|--------|---------|
| Lines | 70% |
| Functions | 70% |
| Branches | 60% |

The thresholds are configured in `package.json` under `jest.coverageThreshold.global`. `npm run test:cov` exits non-zero when any global minimum is missed. CI runs the unit suite through that coverage command, so a pull request cannot pass the unit-test step with coverage below these thresholds. Integration tests run separately and are not included in the coverage command.

When adding a module, start with unit tests for its public behavior and important error branches. Add an integration test when the behavior depends on Nest wiring, validation, authentication, persistence, or an external boundary.