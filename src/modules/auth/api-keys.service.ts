import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const KEY_PREFIX = 'hs_';

export type ApiKeyAuthUser = {
  id: string;
  email: string | null;
  stellarAddress: string | null;
  role: string;
  companyId: string | null;
  apiKeyId: string;
  authType: 'api_key';
};

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyPrefix,
        keyHash,
        userId: user.id,
        companyId: dto.companyId ?? user.id,
        expiresAt: expiresAt ?? undefined,
      },
    });

    this.logger.log(`API key created for user ${user.id}: ${record.id}`);

    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      userId: record.userId,
      companyId: record.companyId,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      // Returned once — never stored or returned again
      apiKey: rawKey,
    };
  }

  async list(userId?: string) {
    return this.prisma.apiKey.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        userId: true,
        companyId: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
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
        revokedAt: true,
      },
    });
  }

  /**
   * Validate a raw X-Api-Key value. Rejects unknown, revoked, or expired keys.
   * Returns a request.user-shaped object compatible with JwtAuthGuard consumers.
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
