import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<any> = {}) => ({
  id: 'user-1',
  email: 'alice@example.com',
  passwordHash: null,
  stellarAddress: 'GABC123',
  name: 'Alice',
  company: null,
  role: 'COMPANY',
  webhookUrl: null,
  avatarUrl: null,
  deactivatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeRefreshToken = (overrides: Partial<any> = {}) => ({
  id: 'rt-1',
  userId: 'user-1',
  tokenHash: 'hashedtoken',
  familyId: 'family-1',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  consumedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

// ── Mock factories ────────────────────────────────────────────────────────────

const makeMockPrisma = () => ({
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeMockJwt = () => ({
  sign: jest.fn().mockReturnValue('access_token'),
  signAsync: jest.fn().mockResolvedValue('refresh_token'),
});

const makeMockConfig = () => ({
  get: jest.fn((key: string, def?: any) => {
    if (key === 'JWT_SECRET') return 'test-secret';
    if (key === 'JWT_ACCESS_EXPIRES_IN') return '15m';
    if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
    if (key === 'JWT_REFRESH_EXPIRES_DAYS') return 7;
    if (key === 'SKIP_ACCOUNT_VALIDATION') return true;
    return def ?? null;
  }),
});

const makeMockStellar = () => ({
  accountExists: jest.fn().mockResolvedValue(true),
});

const makeMockSecurityEvents = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockJwt: ReturnType<typeof makeMockJwt>;
  let mockStellar: ReturnType<typeof makeMockStellar>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();
    mockJwt = makeMockJwt();
    mockStellar = makeMockStellar();

    // Default $transaction: call the callback with mockPrisma
    mockPrisma.$transaction.mockImplementation((fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return Promise.all(fn);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: makeMockConfig() },
        { provide: StellarService, useValue: mockStellar },
        { provide: SecurityEventsService, useValue: makeMockSecurityEvents() },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();

    // Re-bind after clearAllMocks
    mockPrisma.$transaction.mockImplementation((fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return Promise.all(fn);
    });
    mockJwt.sign.mockReturnValue('access_token');
    mockJwt.signAsync.mockResolvedValue('refresh_token');
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe('register()', () => {
    const dto = {
      email: 'alice@example.com',
      password: 'S3cret!',
      name: 'Alice',
    };

    it('creates a user and returns token pair', async () => {
      const user = makeUser({ email: dto.email });
      mockPrisma.user.create.mockResolvedValue(user);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.register(dto as any);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: dto.email }),
        }),
      );
      expect(result).toMatchObject({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
      });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('validates Stellar address when provided and SKIP_ACCOUNT_VALIDATION is false', async () => {
      // Override config to not skip validation
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: JwtService, useValue: mockJwt },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, def?: any) => {
                if (key === 'SKIP_ACCOUNT_VALIDATION') return false;
                if (key === 'JWT_REFRESH_EXPIRES_DAYS') return 7;
                return def ?? null;
              }),
            },
          },
          { provide: StellarService, useValue: mockStellar },
          { provide: SecurityEventsService, useValue: makeMockSecurityEvents() },
        ],
      }).compile();
      const svc2 = module2.get<AuthService>(AuthService);

      mockStellar.accountExists.mockResolvedValueOnce(false);
      const dtoWithAddress = { ...dto, stellarAddress: 'GABC' };

      await expect(svc2.register(dtoWithAddress as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException on duplicate email/address', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: {},
        },
      );
      mockPrisma.user.create.mockRejectedValue(prismaError);

      await expect(service.register(dto as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('returns token pair for valid credentials', async () => {
      const password = 'S3cret!';

      // Register to capture a real password hash generated by the service
      const registeredUser = makeUser({ email: 'test@test.com' });
      mockPrisma.user.create.mockResolvedValue(registeredUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      await service.register({ email: 'test@test.com', password } as any);
      const hash = (mockPrisma.user.create.mock.calls[0][0] as any).data
        .passwordHash;

      const userWithHash = makeUser({
        email: 'alice@example.com',
        passwordHash: hash,
      });
      mockPrisma.user.findUnique.mockResolvedValue(userWithHash);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        email: 'alice@example.com',
        password,
      } as any);
      expect(result).toMatchObject({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
      });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const user = makeUser({ passwordHash: 'scrypt:wrongsalt:wrongkey' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({
          email: 'alice@example.com',
          password: 'wrongpass',
        } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'any' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when account is deactivated', async () => {
      // passwordHash must be non-null so the short-circuit doesn't fire before the deactivated check
      const user = makeUser({
        passwordHash: 'scrypt:placeholder:placeholder',
        deactivatedAt: new Date(),
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      // Bypass actual password hashing — we only want to reach the deactivated check
      jest.spyOn(service as any, 'verifyPassword').mockResolvedValue(true);

      await expect(
        service.login({ email: 'alice@example.com', password: 'any' } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── walletLogin ────────────────────────────────────────────────────────────

  describe('walletLogin()', () => {
    it('is an alias for login()', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.walletLogin({ email: 'x@x.com', password: 'p' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('throws UnauthorizedException when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('bad_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws and revokes family when token already consumed (reuse attack)', async () => {
      const stored = makeRefreshToken({
        consumedAt: new Date(),
        user: makeUser(),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.refresh('any_token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('throws UnauthorizedException for expired token', async () => {
      const stored = makeRefreshToken({
        expiresAt: new Date(Date.now() - 1000),
        user: makeUser(),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      await expect(service.refresh('any_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for revoked token', async () => {
      const stored = makeRefreshToken({
        revokedAt: new Date(),
        user: makeUser(),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      await expect(service.refresh('any_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues new token pair for valid token', async () => {
      const stored = makeRefreshToken({ user: makeUser() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          const tx = {
            refreshToken: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        }
      });

      const result = await service.refresh('valid_token');
      expect(result).toMatchObject({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
      });
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('revokes the refresh token', async () => {
      const stored = makeRefreshToken();
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      mockPrisma.refreshToken.update.mockResolvedValue({
        ...stored,
        revokedAt: new Date(),
      });

      const result = await service.logout('some_token');
      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('returns { revoked: true } even when token is not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      const result = await service.logout('non_existent');
      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('does not revoke an already revoked token', async () => {
      const stored = makeRefreshToken({ revokedAt: new Date() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      const result = await service.logout('some_token');
      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  // ── generateNonce ──────────────────────────────────────────────────────────

  describe('generateNonce()', () => {
    it('returns a nonce string prefixed with hiresettle:', () => {
      const nonce = service.generateNonce('GABC');
      expect(nonce).toMatch(/^hiresettle:GABC:/);
    });
  });
});
