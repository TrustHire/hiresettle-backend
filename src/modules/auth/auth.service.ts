import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const REFRESH_TOKEN_DAYS = 7;

type AuthUser = Omit<User, 'passwordHash'>;

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

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user?.passwordHash || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.deactivatedAt) {
      throw new ForbiddenException('Your account has been deactivated. Please contact an administrator.');
    }

    this.logger.log(`User logged in: ${email}`);
    return this.issueTokenPair(user);
  }

  // Backward-compatible alias kept for existing controller routes
  walletLogin(dto: LoginDto) {
    return this.login(dto);
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

  async logout(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (stored && !stored.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
    }

    return { revoked: true };
  }

  async updateProfile(userId: string, dto: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
      },
    });
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
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
