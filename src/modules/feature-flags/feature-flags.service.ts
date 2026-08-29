import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { FeatureFlag } from '@prisma/client';

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly CACHE_PREFIX = 'feature_flag:';
  private readonly CACHE_TTL_SECONDS = 60; // 1 minute cache

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async isEnabled(flagName: string): Promise<boolean> {
    const cacheKey = `${this.CACHE_PREFIX}${flagName}`;
    
    // Check cache first
    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached !== undefined && cached !== null) {
        return cached === 'true';
      }
    } catch (error) {
      this.logger.warn(`Failed to read from cache for flag ${flagName}: ${error.message}`);
    }

    // Fallback to database
    const flag = await this.prisma.featureFlag.findUnique({
      where: { name: flagName },
    });

    const isEnabled = flag?.isEnabled ?? false;

    // Set cache
    try {
      await this.cacheService.set(cacheKey, isEnabled ? 'true' : 'false', this.CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Failed to write to cache for flag ${flagName}: ${error.message}`);
    }

    return isEnabled;
  }

  async setFlag(name: string, isEnabled: boolean, description?: string): Promise<FeatureFlag> {
    const flag = await this.prisma.featureFlag.upsert({
      where: { name },
      update: { isEnabled, description },
      create: { name, isEnabled, description },
    });

    // Invalidate cache
    try {
      await this.cacheService.del(`${this.CACHE_PREFIX}${name}`);
    } catch (error) {
      this.logger.warn(`Failed to invalidate cache for flag ${name}: ${error.message}`);
    }

    return flag;
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    return this.prisma.featureFlag.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
