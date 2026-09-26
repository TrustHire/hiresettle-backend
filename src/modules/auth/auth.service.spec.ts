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
import { PasswordPolicyService } from '../../common/password/password-policy.service';

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
  lastUsedAt: null,
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
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  recoveryCode: {
    createMany: jest.fn().mockResolvedValue({ count: 10 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  trustedDevice: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findMany: jest.fn(),
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
    if (key === 'IDLE_SESSION_WINDOW_DAYS') return 7;
    if (key === 'SKIP_ACCOUNT_VALIDATION') return true;
    if (key === 'TRUSTED_DEVICE_TTL_DAYS') return 30;
    return def ?? null;
  }),
});

const makeMockStellar = () => ({
  accountExists: jest.fn().mockResolvedValue(true),
});

const makeMockSecurityEvents = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

const makeMockPasswordPolicy = () => ({
  validate: jest.fn(),
  getUnmetRequirements: jest.fn().mockReturnValue([]),
  getPolicy: jest.fn().mockReturnValue({
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
  }),
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
        { provide: PasswordPolicyService, useValue: makeMockPasswordPolicy() },
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
          { provide: PasswordPolicyService, useValue: makeMockPasswordPolicy() },
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

    it('throws UnauthorizedException for an idle session beyond the window', async () => {
      const idleSince = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const stored = makeRefreshToken({
        lastUsedAt: idleSince,
        user: makeUser(),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      await expect(service.refresh('idle_token')).rejects.toThrow(
        UnauthorizedException,
      );
      // An idle rejection must not consume or rotate the token.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a recently active session within the window', async () => {
      const lastUsed = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      const stored = makeRefreshToken({
        lastUsedAt: lastUsed,
        user: makeUser(),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          return fn({
            refreshToken: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              create: jest.fn().mockResolvedValue({}),
            },
          });
        }
      });

      const result = await service.refresh('valid_token');
      expect(result).toMatchObject({ accessToken: 'access_token' });
    });

    it('falls back to createdAt for legacy tokens without lastUsedAt', async () => {
      const stored = makeRefreshToken({
        lastUsedAt: null,
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        user: makeUser(),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      await expect(service.refresh('legacy_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('tracks last activity when rotating a token', async () => {
      const stored = makeRefreshToken({ user: makeUser() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      let txUpdateMany: jest.Mock;
      let txCreate: jest.Mock;
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
          txCreate = jest.fn().mockResolvedValue({});
          return fn({ refreshToken: { updateMany: txUpdateMany, create: txCreate } });
        }
      });

      await service.refresh('valid_token');

      // Consumed row gets its lastUsedAt bumped ...
      expect(txUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        }),
      );
      // ... and the rotated token is minted with a fresh lastUsedAt.
      expect(txCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        }),
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

  // ── getSessions ───────────────────────────────────────────────────────────

  describe('getSessions()', () => {
    it('returns active sessions for a user', async () => {
      const now = new Date();
      const sessions = [
        makeRefreshToken({
          userId: 'user-1',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          consumedAt: null,
        }),
        makeRefreshToken({
          userId: 'user-1',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          consumedAt: now,
        }),
      ];
      mockPrisma.refreshToken.findMany.mockResolvedValue(sessions);

      const result = await service.getSessions('user-1');

      expect(mockPrisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'rt-1',
        familyId: 'family-1',
        isCurrent: true,
      });
      expect(result[1]).toMatchObject({
        isCurrent: false,
      });
    });

    it('excludes revoked and expired sessions', async () => {
      const now = new Date();
      const sessions = [
        makeRefreshToken({
          revokedAt: new Date(),
        }),
        makeRefreshToken({
          expiresAt: new Date(now.getTime() - 1000),
        }),
      ];
      mockPrisma.refreshToken.findMany.mockResolvedValue(sessions);

      const result = await service.getSessions('user-1');

      expect(result).toHaveLength(2);
    });
  });

  // ── revokeSession ─────────────────────────────────────────────────────────

  describe('revokeSession()', () => {
    it('revokes a session successfully', async () => {
      const session = makeRefreshToken({ userId: 'user-1', revokedAt: null });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(session);
      mockPrisma.refreshToken.update.mockResolvedValue({ ...session, revokedAt: new Date() });

      const result = await service.revokeSession('rt-1', 'user-1');

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({ revoked: true, isCurrentSession: false });
    });

    it('throws BadRequestException when session not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.revokeSession('rt-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when trying to revoke another user session', async () => {
      const session = makeRefreshToken({ userId: 'user-2' });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(session);

      await expect(service.revokeSession('rt-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when session already revoked', async () => {
      const session = makeRefreshToken({ userId: 'user-1', revokedAt: new Date() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(session);

      await expect(service.revokeSession('rt-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('detects when current session is revoked', async () => {
      const session = makeRefreshToken({ userId: 'user-1', revokedAt: null, tokenHash: 'abc123' });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(session);
      mockPrisma.refreshToken.update.mockResolvedValue({ ...session, revokedAt: new Date() });

      jest.spyOn(service as any, 'hashRefreshToken').mockReturnValue('abc123');

      const result = await service.revokeSession('rt-1', 'user-1', 'current-token');

      expect(result).toEqual({ revoked: true, isCurrentSession: true });
    });
  });

  // ── generateTotpSecret ─────────────────────────────────────────────────────

  describe('generateTotpSecret()', () => {
    it('generates a TOTP secret for a user', async () => {
      const user = makeUser({ totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);

      const result = await service.generateTotpSecret('user-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpSecret: expect.any(String) },
      });
      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('otpauthUrl');
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('throws BadRequestException when 2FA already enabled', async () => {
      const user = makeUser({ totpEnabled: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(service.generateTotpSecret('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.generateTotpSecret('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── enableTotp ───────────────────────────────────────────────────────────

  describe('enableTotp()', () => {
    it('enables 2FA with valid TOTP code and returns recovery codes', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, totpEnabled: true });

      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);

      // $transaction is called inside createRecoveryCodes — return array results
      mockPrisma.$transaction.mockResolvedValue([{ count: 0 }, { count: 10 }]);

      const result = await service.enableTotp('user-1', '123456');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpEnabled: true },
      });
      expect(result.enabled).toBe(true);
      expect(result.recoveryCodes).toHaveLength(10);
      // Each code should match the XXXXX-XXXXX hex format
      result.recoveryCodes.forEach((code: string) => {
        expect(code).toMatch(/^[0-9A-F]{10}-[0-9A-F]{10}$/);
      });
    });

    it('throws BadRequestException when TOTP secret not found', async () => {
      const user = makeUser({ totpSecret: null, totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(service.enableTotp('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when 2FA already enabled', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(service.enableTotp('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException with invalid TOTP code', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(false);

      await expect(service.enableTotp('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── disableTotp ─────────────────────────────────────────────────────────

  describe('disableTotp()', () => {
    it('disables 2FA with valid TOTP code', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, totpEnabled: false, totpSecret: null });

      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);

      const result = await service.disableTotp('user-1', '123456');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpSecret: null, totpEnabled: false },
      });
      expect(result).toEqual({ disabled: true });
    });

    it('throws BadRequestException when 2FA not enabled', async () => {
      const user = makeUser({ totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(service.disableTotp('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException with invalid TOTP code', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(false);

      await expect(service.disableTotp('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── login() with 2FA recovery code ────────────────────────────────────────

  describe('login() — 2FA recovery code path', () => {
    const password = 'S3cret!';
    let userWithHash: any;

    beforeEach(async () => {
      // Build a real scrypt hash so the password check passes
      const registeredUser = makeUser({ email: 'alice@example.com' });
      mockPrisma.user.create.mockResolvedValue(registeredUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      await service.register({ email: 'alice@example.com', password } as any);
      const hash = (mockPrisma.user.create.mock.calls[0][0] as any).data.passwordHash;
      userWithHash = makeUser({ email: 'alice@example.com', passwordHash: hash });
      jest.clearAllMocks();
      mockPrisma.$transaction.mockImplementation((fn: any) => {
        if (typeof fn === 'function') return fn(mockPrisma);
        return Promise.all(fn);
      });
      mockJwt.sign.mockReturnValue('access_token');
      mockJwt.signAsync.mockResolvedValue('refresh_token');
    });

    it('succeeds with a valid unused recovery code when 2FA is enabled', async () => {
      const user2fa = { ...userWithHash, totpEnabled: true, totpSecret: 'SECRET' };
      mockPrisma.user.findUnique.mockResolvedValue(user2fa);
      mockPrisma.user.update.mockResolvedValue(user2fa);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      // Spy on the private consumeRecoveryCode to return true
      jest.spyOn(service as any, 'consumeRecoveryCode').mockResolvedValue(true);

      const result = await service.login({
        email: 'alice@example.com',
        password,
        recoveryCode: 'AABB11CCDD-EEFF223344',
      } as any);

      expect((service as any).consumeRecoveryCode).toHaveBeenCalledWith(
        user2fa.id,
        'AABB11CCDD-EEFF223344',
      );
      expect(result).toMatchObject({ accessToken: 'access_token' });
    });

    it('throws UnauthorizedException when recovery code is invalid or already used', async () => {
      const user2fa = { ...userWithHash, totpEnabled: true, totpSecret: 'SECRET' };
      mockPrisma.user.findUnique.mockResolvedValue(user2fa);
      mockPrisma.user.update.mockResolvedValue(user2fa);

      jest.spyOn(service as any, 'consumeRecoveryCode').mockResolvedValue(false);

      await expect(
        service.login({
          email: 'alice@example.com',
          password,
          recoveryCode: 'INVALID-CODE',
        } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when neither totpCode nor recoveryCode is provided', async () => {
      const user2fa = { ...userWithHash, totpEnabled: true, totpSecret: 'SECRET' };
      mockPrisma.user.findUnique.mockResolvedValue(user2fa);

      await expect(
        service.login({ email: 'alice@example.com', password } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── regenerateRecoveryCodes ───────────────────────────────────────────────

  describe('regenerateRecoveryCodes()', () => {
    it('returns 10 fresh codes when TOTP is valid', async () => {
      const user = makeUser({ totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);
      mockPrisma.$transaction.mockResolvedValue([{ count: 10 }, { count: 10 }]);

      const result = await service.regenerateRecoveryCodes('user-1', '123456');

      expect(result.recoveryCodes).toHaveLength(10);
      result.recoveryCodes.forEach((code: string) => {
        expect(code).toMatch(/^[0-9A-F]{10}-[0-9A-F]{10}$/);
      });
    });

    it('all generated codes are unique', async () => {
      const user = makeUser({ totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);
      mockPrisma.$transaction.mockResolvedValue([{ count: 0 }, { count: 10 }]);

      const result = await service.regenerateRecoveryCodes('user-1', '123456');
      const unique = new Set(result.recoveryCodes);
      expect(unique.size).toBe(10);
    });

    it('throws BadRequestException when 2FA is not enabled', async () => {
      const user = makeUser({ totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.regenerateRecoveryCodes('user-1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when TOTP code is invalid', async () => {
      const user = makeUser({ totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(false);

      await expect(
        service.regenerateRecoveryCodes('user-1', '000000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.regenerateRecoveryCodes('ghost', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('calls $transaction to delete old codes and insert new ones', async () => {
      const user = makeUser({ totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);
      mockPrisma.$transaction.mockResolvedValue([{ count: 5 }, { count: 10 }]);

      await service.regenerateRecoveryCodes('user-1', '123456');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ── consumeRecoveryCode (private) ─────────────────────────────────────────

  describe('consumeRecoveryCode() (private)', () => {
    it('returns true and marks the code used when valid', async () => {
      const record = { id: 'rc-1', userId: 'user-1', codeHash: 'some-hash', usedAt: null };
      mockPrisma.recoveryCode.findFirst.mockResolvedValue(record);
      mockPrisma.recoveryCode.update.mockResolvedValue({ ...record, usedAt: new Date() });

      const result = await (service as any).consumeRecoveryCode('user-1', 'AABB11CCDD-EEFF223344');

      expect(mockPrisma.recoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'rc-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(result).toBe(true);
    });

    it('returns false when no matching unused code exists', async () => {
      mockPrisma.recoveryCode.findFirst.mockResolvedValue(null);

      const result = await (service as any).consumeRecoveryCode('user-1', 'BADCODE');

      expect(result).toBe(false);
      expect(mockPrisma.recoveryCode.update).not.toHaveBeenCalled();
    });

    it('hashes the code before lookup (case-insensitive normalisation)', async () => {
      mockPrisma.recoveryCode.findFirst.mockResolvedValue(null);

      // Call with lowercase code
      await (service as any).consumeRecoveryCode('user-1', 'aabb11ccdd-eeff223344');

      // findFirst should be called with the SHA-256 hash of the uppercased code
      const { createHash } = await import('crypto');
      const expected = createHash('sha256')
        .update('AABB11CCDD-EEFF223344')
        .digest('hex');

      expect(mockPrisma.recoveryCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ codeHash: expected }),
        }),
      );
    });
  });

  // ── issueTrustedDeviceToken ───────────────────────────────────────────────

  describe('issueTrustedDeviceToken()', () => {
    it('stores a hashed token and returns the raw token', async () => {
      mockPrisma.trustedDevice.create.mockResolvedValue({ id: 'td-1' });

      const token = await service.issueTrustedDeviceToken('user-1', 'Mozilla/5.0');

      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64); // 32 random bytes → 64 hex chars

      expect(mockPrisma.trustedDevice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tokenHash: expect.any(String),
            name: 'Mozilla/5.0',
            expiresAt: expect.any(Date),
          }),
        }),
      );

      // Stored hash must be the SHA-256 of the returned raw token
      const { createHash } = await import('crypto');
      const expectedHash = createHash('sha256').update(token).digest('hex');
      const storedHash = (mockPrisma.trustedDevice.create.mock.calls[0][0] as any).data.tokenHash;
      expect(storedHash).toBe(expectedHash);
    });

    it('sets expiresAt 30 days in the future by default', async () => {
      mockPrisma.trustedDevice.create.mockResolvedValue({ id: 'td-1' });
      const before = Date.now();
      await service.issueTrustedDeviceToken('user-1');
      const after = Date.now();

      const expiresAt: Date = (mockPrisma.trustedDevice.create.mock.calls[0][0] as any).data.expiresAt;
      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs + 1000);
    });

    it('truncates userAgent to 120 chars for the name field', async () => {
      mockPrisma.trustedDevice.create.mockResolvedValue({ id: 'td-1' });
      const longAgent = 'A'.repeat(200);
      await service.issueTrustedDeviceToken('user-1', longAgent);
      const name = (mockPrisma.trustedDevice.create.mock.calls[0][0] as any).data.name;
      expect(name).toHaveLength(120);
    });
  });

  // ── verifyTrustedDeviceToken ──────────────────────────────────────────────

  describe('verifyTrustedDeviceToken()', () => {
    const makeDevice = (overrides: Partial<any> = {}) => ({
      id: 'td-1',
      userId: 'user-1',
      tokenHash: 'some-hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    });

    it('returns true and updates lastUsedAt for a valid token', async () => {
      const device = makeDevice();
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      mockPrisma.trustedDevice.update.mockResolvedValue(device);

      const result = await service.verifyTrustedDeviceToken('user-1', 'raw-token');
      expect(result).toBe(true);
      expect(mockPrisma.trustedDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'td-1' },
          data: { lastUsedAt: expect.any(Date) },
        }),
      );
    });

    it('returns false when token not found', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(null);
      const result = await service.verifyTrustedDeviceToken('user-1', 'bad-token');
      expect(result).toBe(false);
    });

    it('returns false when device belongs to a different user', async () => {
      const device = makeDevice({ userId: 'user-2' });
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      const result = await service.verifyTrustedDeviceToken('user-1', 'raw-token');
      expect(result).toBe(false);
    });

    it('returns false when device is revoked', async () => {
      const device = makeDevice({ revokedAt: new Date() });
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      const result = await service.verifyTrustedDeviceToken('user-1', 'raw-token');
      expect(result).toBe(false);
    });

    it('returns false when device is expired', async () => {
      const device = makeDevice({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      const result = await service.verifyTrustedDeviceToken('user-1', 'raw-token');
      expect(result).toBe(false);
    });
  });

  // ── login() — trusted device skip path ───────────────────────────────────

  describe('login() — trusted device skip path', () => {
    const password = 'S3cret!';
    let hashCapture: string;

    beforeEach(async () => {
      const registeredUser = makeUser({ email: 'alice@example.com' });
      mockPrisma.user.create.mockResolvedValue(registeredUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      await service.register({ email: 'alice@example.com', password } as any);
      hashCapture = (mockPrisma.user.create.mock.calls[0][0] as any).data.passwordHash;
      jest.clearAllMocks();
      mockPrisma.$transaction.mockImplementation((fn: any) => {
        if (typeof fn === 'function') return fn(mockPrisma);
        return Promise.all(fn);
      });
      mockJwt.sign.mockReturnValue('access_token');
      mockJwt.signAsync.mockResolvedValue('refresh_token');
    });

    it('skips 2FA when a valid trusted device token is supplied', async () => {
      const user2fa = makeUser({
        passwordHash: hashCapture,
        totpEnabled: true,
        totpSecret: 'SECRET',
      });
      mockPrisma.user.findUnique.mockResolvedValue(user2fa);
      mockPrisma.user.update.mockResolvedValue(user2fa);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      jest.spyOn(service, 'verifyTrustedDeviceToken').mockResolvedValue(true);

      const result = await service.login({
        email: 'alice@example.com',
        password,
        trustedDeviceToken: 'some-valid-token',
      } as any);

      expect(service.verifyTrustedDeviceToken).toHaveBeenCalledWith(
        user2fa.id,
        'some-valid-token',
      );
      expect(result).toMatchObject({ accessToken: 'access_token' });
    });

    it('issues a trusted device token when trustDevice=true after valid 2FA', async () => {
      const user2fa = makeUser({
        passwordHash: hashCapture,
        totpEnabled: true,
        totpSecret: 'SECRET',
      });
      mockPrisma.user.findUnique.mockResolvedValue(user2fa);
      mockPrisma.user.update.mockResolvedValue(user2fa);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.trustedDevice.create.mockResolvedValue({ id: 'td-1' });

      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);
      jest.spyOn(service, 'issueTrustedDeviceToken').mockResolvedValue('new-device-token');

      const result = await service.login({
        email: 'alice@example.com',
        password,
        totpCode: '123456',
        trustDevice: true,
      } as any);

      expect(service.issueTrustedDeviceToken).toHaveBeenCalledWith(
        user2fa.id,
        undefined,
      );
      expect(result).toMatchObject({
        accessToken: 'access_token',
        trustedDeviceToken: 'new-device-token',
      });
    });

    it('does not issue a trusted device token when trustDevice is false', async () => {
      const user2fa = makeUser({
        passwordHash: hashCapture,
        totpEnabled: true,
        totpSecret: 'SECRET',
      });
      mockPrisma.user.findUnique.mockResolvedValue(user2fa);
      mockPrisma.user.update.mockResolvedValue(user2fa);
      mockPrisma.refreshToken.create.mockResolvedValue({});

      jest.spyOn(service as any, 'verifyTotpCode').mockReturnValue(true);
      jest.spyOn(service, 'issueTrustedDeviceToken').mockResolvedValue('token');

      const result = await service.login({
        email: 'alice@example.com',
        password,
        totpCode: '123456',
      } as any);

      expect(service.issueTrustedDeviceToken).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('trustedDeviceToken');
    });
  });

  // ── listTrustedDevices ────────────────────────────────────────────────────

  describe('listTrustedDevices()', () => {
    it('returns active devices ordered by lastUsedAt desc', async () => {
      const devices = [
        { id: 'td-1', name: 'Firefox', lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 1e9), createdAt: new Date() },
        { id: 'td-2', name: 'Chrome', lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 1e9), createdAt: new Date() },
      ];
      mockPrisma.trustedDevice.findMany.mockResolvedValue(devices);

      const result = await service.listTrustedDevices('user-1');

      expect(mockPrisma.trustedDevice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1', revokedAt: null }),
          orderBy: { lastUsedAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(2);
    });
  });

  // ── revokeTrustedDevice ───────────────────────────────────────────────────

  describe('revokeTrustedDevice()', () => {
    const makeDevice = (overrides: Partial<any> = {}) => ({
      id: 'td-1',
      userId: 'user-1',
      revokedAt: null,
      ...overrides,
    });

    it('revokes a device successfully', async () => {
      const device = makeDevice();
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      mockPrisma.trustedDevice.update.mockResolvedValue({ ...device, revokedAt: new Date() });

      const result = await service.revokeTrustedDevice('td-1', 'user-1');

      expect(mockPrisma.trustedDevice.update).toHaveBeenCalledWith({
        where: { id: 'td-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({ revoked: true });
    });

    it('throws BadRequestException when device not found', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(null);
      await expect(service.revokeTrustedDevice('td-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when device belongs to another user', async () => {
      const device = makeDevice({ userId: 'user-2' });
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      await expect(service.revokeTrustedDevice('td-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when device is already revoked', async () => {
      const device = makeDevice({ revokedAt: new Date() });
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(device);
      await expect(service.revokeTrustedDevice('td-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── resetPassword ─────────────────────────────────────────────────────────

  describe('resetPassword()', () => {
    const newPassword = 'NewS3cret!';

    it('updates password hash and revokes all trusted devices', async () => {
      const password = 'OldS3cret!';

      // Build a real hash for the current password
      const registeredUser = makeUser({ email: 'bob@example.com' });
      mockPrisma.user.create.mockResolvedValue(registeredUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      await service.register({ email: 'bob@example.com', password } as any);
      const currentHash = (mockPrisma.user.create.mock.calls[0][0] as any).data.passwordHash;

      jest.clearAllMocks();
      mockPrisma.$transaction.mockImplementation((fn: any) => {
        if (typeof fn === 'function') return fn(mockPrisma);
        return Promise.all(fn);
      });

      const user = makeUser({ passwordHash: currentHash });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, passwordHash: 'new-hash' });
      mockPrisma.trustedDevice.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.resetPassword('user-1', password, newPassword);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ passwordHash: expect.any(String) }),
        }),
      );
      // All trusted devices should be revoked
      expect(mockPrisma.trustedDevice.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({ updated: true });
    });

    it('throws UnauthorizedException when current password is wrong', async () => {
      const user = makeUser({ passwordHash: 'scrypt:salt:key' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyPassword').mockResolvedValue(false);

      await expect(
        service.resetPassword('user-1', 'wrong-password', newPassword),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when user has no password (OAuth-only account)', async () => {
      const user = makeUser({ passwordHash: null });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.resetPassword('user-1', 'any', newPassword),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('ghost', 'any', newPassword),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
