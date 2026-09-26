import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyScope, SCOPES_KEY } from '../../common/decorators/api-key-scopes.decorator';
import { ApiKeyScopesGuard } from '../../common/guards/api-key-scopes.guard';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  user: Record<string, any> | null,
  requiredScopes: ApiKeyScope[] | undefined,
): any {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredScopes),
  } as unknown as Reflector;

  const guard = new ApiKeyScopesGuard(reflector);
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as any;

  return { guard, context, reflector };
}

// ── ApiKeyScopesGuard ─────────────────────────────────────────────────────────

describe('ApiKeyScopesGuard', () => {
  describe('canActivate()', () => {
    it('passes when no @RequireScopes is declared', () => {
      const { guard, context } = makeContext(
        { authType: 'api_key', scopes: [] },
        undefined,
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes when @RequireScopes is empty array', () => {
      const { guard, context } = makeContext(
        { authType: 'api_key', scopes: [] },
        [],
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes for JWT user even when scope required', () => {
      const { guard, context } = makeContext(
        { authType: 'jwt', scopes: [] },
        [ApiKeyScope.ENGAGEMENTS_READ],
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes for JWT user with no authType set', () => {
      const { guard, context } = makeContext(
        { id: 'user-1', role: 'COMPANY' },
        [ApiKeyScope.ENGAGEMENTS_READ],
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes for unauthenticated request (no user)', () => {
      const { guard, context } = makeContext(null, [ApiKeyScope.ENGAGEMENTS_READ]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes when API key scopes is empty (unrestricted legacy key)', () => {
      const { guard, context } = makeContext(
        { authType: 'api_key', scopes: [] },
        [ApiKeyScope.ENGAGEMENTS_READ],
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes when API key has the required scope', () => {
      const { guard, context } = makeContext(
        { authType: 'api_key', scopes: [ApiKeyScope.ENGAGEMENTS_READ] },
        [ApiKeyScope.ENGAGEMENTS_READ],
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('passes when API key has one of several required scopes', () => {
      const { guard, context } = makeContext(
        {
          authType: 'api_key',
          scopes: [ApiKeyScope.ENGAGEMENTS_WRITE],
        },
        [ApiKeyScope.ENGAGEMENTS_READ, ApiKeyScope.ENGAGEMENTS_WRITE],
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws ForbiddenException when API key lacks required scope', () => {
      const { guard, context } = makeContext(
        { authType: 'api_key', scopes: [ApiKeyScope.NOTIFICATIONS_READ] },
        [ApiKeyScope.ENGAGEMENTS_READ],
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('forbidden error message lists the required scope(s)', () => {
      const { guard, context } = makeContext(
        { authType: 'api_key', scopes: [ApiKeyScope.NOTIFICATIONS_READ] },
        [ApiKeyScope.ENGAGEMENTS_READ],
      );
      try {
        guard.canActivate(context);
        fail('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain(ApiKeyScope.ENGAGEMENTS_READ);
      }
    });

    it('throws ForbiddenException when key has multiple scopes but none match', () => {
      const { guard, context } = makeContext(
        {
          authType: 'api_key',
          scopes: [ApiKeyScope.NOTIFICATIONS_READ, ApiKeyScope.MILESTONES_READ],
        },
        [ApiKeyScope.ENGAGEMENTS_WRITE, ApiKeyScope.WEBHOOKS_MANAGE],
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});

// ── ApiKeysService — scopes ───────────────────────────────────────────────────

describe('ApiKeysService — scopes', () => {
  let service: ApiKeysService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
      apiKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  const makeUser = () => ({
    id: 'user-1',
    deletedAt: null,
    deactivatedAt: null,
  });

  it('stores scopes provided at creation', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'key-1',
      name: 'Test',
      keyPrefix: 'hs_12345678',
      userId: user.id,
      companyId: user.id,
      scopes: [ApiKeyScope.ENGAGEMENTS_READ],
      expiresAt: null,
      createdAt: new Date(),
    });

    const result = await service.create({
      userId: user.id,
      name: 'Test',
      scopes: [ApiKeyScope.ENGAGEMENTS_READ],
    });

    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scopes: [ApiKeyScope.ENGAGEMENTS_READ],
        }),
      }),
    );
    expect(result.scopes).toEqual([ApiKeyScope.ENGAGEMENTS_READ]);
  });

  it('defaults scopes to an empty array when not provided', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'key-1',
      name: 'Test',
      keyPrefix: 'hs_12345678',
      userId: user.id,
      companyId: user.id,
      scopes: [],
      expiresAt: null,
      createdAt: new Date(),
    });

    await service.create({ userId: user.id, name: 'Test' });

    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopes: [] }),
      }),
    );
  });

  it('includes scopes in authenticate() return value', async () => {
    const keyScopes = [ApiKeyScope.ENGAGEMENTS_READ, ApiKeyScope.MILESTONES_READ];
    const hashFn = service.hashKey('hs_' + 'a'.repeat(64));

    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: service.hashKey('hs_testkey'),
      scopes: keyScopes,
      revokedAt: null,
      expiresAt: null,
      companyId: 'user-1',
      user: {
        id: 'user-1',
        email: 'test@example.com',
        stellarAddress: null,
        role: 'COMPANY',
        deactivatedAt: null,
        deletedAt: null,
      },
    });
    mockPrisma.apiKey.update.mockResolvedValue({});

    const result = await service.authenticate('hs_testkey');

    expect(result.scopes).toEqual(keyScopes);
    expect(result.authType).toBe('api_key');
  });

  it('includes scopes in list() results', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([
      {
        id: 'key-1',
        name: 'Read-only key',
        keyPrefix: 'hs_12345678',
        userId: 'user-1',
        companyId: 'user-1',
        scopes: [ApiKeyScope.ENGAGEMENTS_READ],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      },
    ]);

    const result = await service.list('user-1');
    expect(result[0].scopes).toEqual([ApiKeyScope.ENGAGEMENTS_READ]);
  });
});

// ── Integration: guard enforces scope end-to-end ─────────────────────────────

describe('ApiKeyScopesGuard — integration with SCOPES_KEY metadata', () => {
  it('reads the SCOPES_KEY from reflector correctly', () => {
    const reflector = new Reflector();
    const guard = new ApiKeyScopesGuard(reflector);

    // Build a minimal handler with SCOPES_KEY metadata directly
    const handler = () => {};
    Reflect.defineMetadata(SCOPES_KEY, [ApiKeyScope.WEBHOOKS_MANAGE], handler);

    const context = {
      getHandler: () => handler,
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            authType: 'api_key',
            scopes: [ApiKeyScope.ENGAGEMENTS_READ],
          },
        }),
      }),
    } as any;

    // Key has engagements:read but route requires webhooks:manage → 403
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows access when key has the exact required scope', () => {
    const reflector = new Reflector();
    const guard = new ApiKeyScopesGuard(reflector);

    const handler = () => {};
    Reflect.defineMetadata(SCOPES_KEY, [ApiKeyScope.WEBHOOKS_MANAGE], handler);

    const context = {
      getHandler: () => handler,
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            authType: 'api_key',
            scopes: [ApiKeyScope.WEBHOOKS_MANAGE],
          },
        }),
      }),
    } as any;

    expect(guard.canActivate(context)).toBe(true);
  });
});
