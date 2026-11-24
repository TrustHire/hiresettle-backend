import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException, ForbiddenException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyLimitsDto } from './dto/update-api-key-limits.dto';
import { quotaPeriod, secondsUntilNextMonth } from '../../common/guards/user-jwt-sub-throttler.guard';

const KEY_PREFIX = 'hs_';

export type ApiKeyAuthUser = {
  id: string;
  email: string | null;
  stellarAddress: string | null;
  role: string;
  companyId: string | null;
  apiKeyId: string;
  scopes: string[];
  authType: 'api_key';
};

const API_KEY_PUBLIC_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  userId: true,
  companyId: true,
  scopes: true,
  rateLimit: true,
  monthlyQuota: true,
  quotaPeriod: true,
  quotaUsed: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Create a key. Raw key is returned once; only the hash is persisted. */
  async create(dto: CreateApiKeyDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user || user.deletedAt || user.deactivatedAt) {
      throw new NotFoundException('User not found or unavailable');
    }

    const rawKey = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 11); // hs_ + 8 hex chars

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const scopes = dto.scopes ?? [];

    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyPrefix,
        keyHash,
        userId: user.id,
        companyId: dto.companyId ?? user.id,
        expiresAt: expiresAt ?? undefined,
        scopes,
        rateLimit: dto.rateLimit ?? null,
        monthlyQuota: dto.monthlyQuota ?? null,
      },
    });

    this.logger.log(`API key created for user ${user.id}: ${record.id} scopes=[${scopes.join(',')}]`);

    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      userId: record.userId,
      companyId: record.companyId,
      scopes: record.scopes,
      rateLimit: record.rateLimit,
      monthlyQuota: record.monthlyQuota,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      // Returned once — never stored or returned again
      apiKey: rawKey,
    };
  }

  async list(userId?: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
      select: API_KEY_PUBLIC_SELECT,
    });
    return keys.map((k) => this.withUsage(k));
  }

  /** Usage of one key in the current month. Owners may only read their own keys. */
  async getUsage(id: string, requesterId?: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id }, select: API_KEY_PUBLIC_SELECT });
    if (!key) throw new NotFoundException('API key not found');
    if (requesterId && key.userId !== requesterId) throw new ForbiddenException('Not your API key');
    return this.withUsage(key).usage;
  }

  /**
   * Change a key's limits. Admins may set any value. Owners (requesterId set)
   * may only change their own active keys, within the configured ceilings, and
   * may not make the quota unlimited.
   */
  async updateLimits(id: string, dto: UpdateApiKeyLimitsDto, requesterId?: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    if (requesterId) {
      if (key.userId !== requesterId) throw new ForbiddenException('Not your API key');
      if (key.revokedAt) throw new BadRequestException('API key has been revoked');

      const maxRate = Number(
        this.config?.get('API_KEY_OWNER_MAX_RATE_LIMIT') ?? this.config?.get('THROTTLE_LIMIT') ?? 100,
      );
      const maxQuota = Number(this.config?.get('API_KEY_OWNER_MAX_MONTHLY_QUOTA') ?? 100000);
      if (dto.rateLimit != null && dto.rateLimit > maxRate) {
        throw new BadRequestException(`rateLimit cannot exceed ${maxRate}; contact support for a higher limit`);
      }
      if (dto.monthlyQuota === null) {
        throw new BadRequestException('Only an admin can remove the monthly quota');
      }
      if (dto.monthlyQuota != null && dto.monthlyQuota > maxQuota) {
        throw new BadRequestException(`monthlyQuota cannot exceed ${maxQuota}; contact support for a higher quota`);
      }
    }

    const data: { rateLimit?: number | null; monthlyQuota?: number | null } = {};
    if (dto.rateLimit !== undefined) data.rateLimit = dto.rateLimit;
    if (dto.monthlyQuota !== undefined) data.monthlyQuota = dto.monthlyQuota;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Provide rateLimit and/or monthlyQuota');
    }

    const updated = await this.prisma.apiKey.update({ where: { id }, data, select: API_KEY_PUBLIC_SELECT });
    this.logger.log(
      `API key ${id} limits updated by ${requesterId ? `owner ${requesterId}` : 'admin'}: ` +
        `rateLimit=${updated.rateLimit ?? 'default'} monthlyQuota=${updated.monthlyQuota ?? 'unlimited'}`,
    );
    return this.withUsage(updated);
  }

  private withUsage<T extends { quotaPeriod: string | null; quotaUsed: number; monthlyQuota: number | null }>(key: T) {
    const { quotaPeriod: period, quotaUsed, ...rest } = key;
    const current = quotaPeriod();
    const used = period === current ? quotaUsed : 0;
    return {
      ...rest,
      usage: {
        period: current,
        used,
        limit: key.monthlyQuota,
        remaining: key.monthlyQuota === null ? null : Math.max(0, key.monthlyQuota - used),
        resetsInSeconds: secondsUntilNextMonth(),
      },
    };
  }

  async revoke(id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');
    if (key.revokedAt) throw new BadRequestException('API key already revoked');

    return this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        userId: true,
        scopes: true,
        revokedAt: true,
      },
    });
  }

  /**
   * Validate a raw X-Api-Key value. Rejects unknown, revoked, or expired keys.
   * Returns a request.user-shaped object compatible with JwtAuthGuard consumers.
   * The `scopes` field is included so ApiKeyScopesGuard can enforce route-level
   * scope requirements without an extra DB query.
   */
  async authenticate(rawKey: string): Promise<ApiKeyAuthUser> {
    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('Missing API key');
    }

    const keyHash = this.hashKey(rawKey);
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            stellarAddress: true,
            role: true,
            deactivatedAt: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!record || !this.hashesEqual(record.keyHash, keyHash)) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (record.revokedAt) {
      throw new UnauthorizedException('API key has been revoked');
    }

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('API key has expired');
    }

    if (record.user.deactivatedAt || record.user.deletedAt) {
      throw new UnauthorizedException('API key owner is unavailable');
    }

    this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      id: record.user.id,
      email: record.user.email,
      stellarAddress: record.user.stellarAddress,
      role: record.user.role,
      companyId: record.companyId,
      apiKeyId: record.id,
      scopes: record.scopes,
      authType: 'api_key',
    };
  }

  hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private hashesEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
