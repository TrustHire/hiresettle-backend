import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, SecurityEventAction, User } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { TOTP } from 'otpauth';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const REFRESH_TOKEN_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
const IMPERSONATION_TOKEN_TTL_SECONDS = 5 * 60;

type AuthUser = Omit<User, 'passwordHash' | 'webhookSecret'>;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Kept for the existing nonce endpoint while email/password auth becomes primary.
  private readonly nonces = new Map<string, { nonce: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly stellar: StellarService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  generateNonce(stellarAddress: string): string {
    const nonce = `hiresettle:${stellarAddress}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.nonces.set(stellarAddress, {
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return nonce;
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const passwordHash = await this.hashPassword(dto.password);

    if (dto.stellarAddress) {
      const skipAccountValidation = this.config.get<boolean>('SKIP_ACCOUNT_VALIDATION');
      if (!skipAccountValidation) {
        const accountExists = await this.stellar.accountExists(dto.stellarAddress);
        if (!accountExists) {
          throw new BadRequestException('Stellar address does not exist or is not funded.');
        }
      }
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          stellarAddress: dto.stellarAddress,
          name: dto.name,
          company: dto.company,
          role: dto.role,
        },
      });

      this.logger.log(`User registered: ${email}`);
      return this.issueTokenPair(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email or Stellar address is already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto, meta: RequestMeta = {}) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user?.passwordHash || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      await this.handleFailedLogin(user?.id, meta);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.deactivatedAt) {
      await this.logSecurityEvent(SecurityEventAction.LOGIN_FAILURE, user.id, meta);
      throw new ForbiddenException('Your account has been deactivated. Please contact an administrator.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.logSecurityEvent(SecurityEventAction.LOGIN_FAILURE, user.id, meta);
      const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw new HttpException(
        {
          message: 'Account temporarily locked due to repeated failed login attempts',
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Check if 2FA is enabled
    if (user.totpEnabled) {
      if (!dto.totpCode) {
        throw new UnauthorizedException('TOTP code required for 2FA-enabled account');
      }

      const isValid = this.verifyTotpCode(user.totpSecret!, dto.totpCode);
      if (!isValid) {
        await this.handleFailedLogin(user.id, meta);
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    await this.resetFailedAttempts(user.id);
    this.logger.log(`User logged in: ${email}`);
    await this.logSecurityEvent(SecurityEventAction.LOGIN_SUCCESS, user.id, meta);
    return this.issueTokenPair(user);
  }

  // Backward-compatible alias kept for existing controller routes
  walletLogin(dto: LoginDto, meta: RequestMeta = {}) {
    return this.login(dto, meta);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const now = new Date();

    if (stored.consumedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.revokedAt || stored.expiresAt <= now) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const nextRefreshToken = await this.signRefreshToken(stored.user, stored.familyId);
    const nextRefreshTokenHash = this.hashRefreshToken(nextRefreshToken);
    const nextExpiresAt = this.refreshExpiryDate();

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshToken.updateMany({
        where: { id: stored.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        throw new UnauthorizedException('Refresh token reuse detected');
      }

      await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: nextRefreshTokenHash,
          familyId: stored.familyId,
          expiresAt: nextExpiresAt,
        },
      });
    });

    return {
      accessToken: this.signAccessToken(stored.user),
      refreshToken: nextRefreshToken,
      user: this.sanitizeUser(stored.user),
    };
  }

  async issueImpersonationToken(
    adminId: string,
    targetUserId: string,
    meta: RequestMeta = {},
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!target || target.deletedAt || target.deactivatedAt) {
      throw new ForbiddenException('User is not available for impersonation');
    }

    const accessToken = this.jwt.sign(
      {
        sub: target.id,
        email: target.email,
        stellarAddress: target.stellarAddress,
        role: target.role,
        type: 'access',
        impersonated: true,
        impersonatorId: adminId,
      },
      { expiresIn: IMPERSONATION_TOKEN_TTL_SECONDS },
    );

    await this.securityEvents.log({
      userId: target.id,
      actorId: adminId,
      targetUserId: target.id,
      action: SecurityEventAction.IMPERSONATION_ISSUED,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      accessToken,
      expiresIn: IMPERSONATION_TOKEN_TTL_SECONDS,
      user: this.sanitizeUser(target),
    };
  }

  async logout(refreshToken: string, meta: RequestMeta = {}) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (stored && !stored.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
    }

    await this.logSecurityEvent(SecurityEventAction.LOGOUT, stored?.userId, meta);
    return { revoked: true };
  }

  async updateProfile(userId: string, dto: any): Promise<AuthUser & { webhookSecret?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });

    // Generate a signing secret the first time a webhook subscription is created.
    const isNewWebhookSubscription = !!dto.webhookUrl && !existing?.webhookUrl;
    const webhookSecret = isNewWebhookSubscription ? randomBytes(32).toString('hex') : undefined;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      },
    });

    const safeUser = this.sanitizeUser(updated);
    // Returned once, at creation time — never persisted in a response again.
    return webhookSecret ? { ...safeUser, webhookSecret } : safeUser;
  }

  async getSessions(userId: string) {
    const now = new Date();
    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      familyId: session.familyId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: session.consumedAt === null,
    }));
  }

  async revokeSession(sessionId: string, userId: string, currentRefreshToken?: string) {
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('You can only revoke your own sessions');
    }

    if (session.revokedAt) {
      throw new BadRequestException('Session already revoked');
    }

    await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    // Check if the revoked session is the current one
    let isCurrentSession = false;
    if (currentRefreshToken) {
      const currentTokenHash = this.hashRefreshToken(currentRefreshToken);
      isCurrentSession = session.tokenHash === currentTokenHash;
    }

    return { revoked: true, isCurrentSession };
  }

  async generateTotpSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.totpEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    // Generate a random base32 secret
    const secretBytes = randomBytes(20);
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    for (let i = 0; i < secretBytes.length; i += 5) {
      const chunk = secretBytes.slice(i, i + 5);
      secret += this.base32Encode(chunk);
    }

    const totp = new TOTP({
      issuer: 'HireSettle',
      label: user.email || user.stellarAddress || userId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const otpauthUrl = totp.toString();

    // Store the secret temporarily (not enabled yet)
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    return {
      secret,
      otpauthUrl,
    };
  }

  private base32Encode(bytes: Buffer): string {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;

      while (bits >= 5) {
        output += base32Chars[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += base32Chars[(value << (5 - bits)) & 31];
    }

    return output;
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpSecret) {
      throw new BadRequestException('TOTP secret not found. Please generate a secret first.');
    }

    if (user.totpEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    const isValid = this.verifyTotpCode(user.totpSecret, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });

    this.logger.log(`2FA enabled for user: ${user.email || userId}`);
    return { enabled: true };
  }

  async disableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.totpEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    const isValid = this.verifyTotpCode(user.totpSecret!, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpEnabled: false,
      },
    });

    this.logger.log(`2FA disabled for user: ${user.email || userId}`);
    return { disabled: true };
  }

  private verifyTotpCode(secret: string, code: string): boolean {
    const totp = new TOTP({
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  }

  private async issueTokenPair(user: User) {
    const familyId = randomBytes(24).toString('hex');
    const refreshToken = await this.signRefreshToken(user, familyId);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        familyId,
        expiresAt: this.refreshExpiryDate(),
      },
    });

    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  private signAccessToken(user: User): string {
    return this.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        stellarAddress: user.stellarAddress,
        role: user.role,
        type: 'access',
      },
      { expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') },
    );
  }

  private async signRefreshToken(user: User, familyId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, familyId, type: 'refresh' },
      { expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') },
    );
  }

  private refreshExpiryDate(): Date {
    const days = this.config.get<number>('JWT_REFRESH_EXPIRES_DAYS', REFRESH_TOKEN_DAYS);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return `scrypt:${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [algorithm, salt, key] = passwordHash.split(':');
    if (algorithm !== 'scrypt' || !salt || !key) return false;

    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    const storedKey = Buffer.from(key, 'hex');

    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private sanitizeUser(user: User): AuthUser {
    const { passwordHash, webhookSecret, ...safeUser } = user;
    return safeUser;
  }

  private async logSecurityEvent(
    action: SecurityEventAction,
    userId: string | null | undefined,
    meta: RequestMeta,
  ) {
    await this.securityEvents.log({
      userId,
      action,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async handleFailedLogin(userId: string | undefined, meta: RequestMeta) {
    if (!userId) {
      await this.logSecurityEvent(SecurityEventAction.LOGIN_FAILURE, null, meta);
      return;
    }

    await this.logSecurityEvent(SecurityEventAction.LOGIN_FAILURE, userId, meta);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const newFailedAttempts = (user.failedLoginAttempts || 0) + 1;

    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newFailedAttempts,
          lockedUntil,
        },
      });
      this.logger.warn(`Account locked: ${user.email} after ${newFailedAttempts} failed attempts`);
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newFailedAttempts,
        },
      });
    }
  }

  private async resetFailedAttempts(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }
}
