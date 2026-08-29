import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

/**
 * CacheService — cache-aside store with optional Redis backend.
 *
 * When REDIS_URL is set the service connects to Redis via ioredis
 * (install with: npm install ioredis).
 * When REDIS_URL is absent it falls back to an in-process Map store
 * so the application works without any external dependencies.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  // In-memory store — used when REDIS_URL is not configured
  private readonly memStore = new Map<string, CacheEntry>();
  private memEvictionTimer?: NodeJS.Timeout;

  // ioredis client — populated in onModuleInit when REDIS_URL is present
  private redisClient?: any;
  private useRedis = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (redisUrl) {
      try {
        // Dynamic require so the app starts without ioredis installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Redis = require('ioredis');
        this.redisClient = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
        await this.redisClient.connect();
        this.useRedis = true;
        this.logger.log('CacheService: connected to Redis');
      } catch (err) {
        this.logger.warn(
          `CacheService: failed to connect to Redis (${(err as Error).message}). Falling back to in-memory store.`,
        );
      }
    } else {
      this.logger.log('CacheService: REDIS_URL not set — using in-memory store');
    }

    // Periodic eviction sweep for the in-memory store (every 30 s)
    this.memEvictionTimer = setInterval(() => this.evictExpired(), 30_000);
  }

  async onModuleDestroy() {
    if (this.memEvictionTimer) clearInterval(this.memEvictionTimer);
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // best-effort disconnect
      }
    }
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  async get<T = unknown>(key: string): Promise<T | null> {
    if (this.useRedis) {
      const raw = await this.redisClient.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }

    const entry = this.memStore.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.useRedis) {
      await this.redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    }

    this.memStore.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
  }

  async del(key: string): Promise<void> {
    if (this.useRedis) {
      await this.redisClient.del(key);
      return;
    }
    this.memStore.delete(key);
  }

  async flush(): Promise<void> {
    if (this.useRedis) {
      await this.redisClient.flushdb();
      return;
    }
    this.memStore.clear();
  }

  // ----------------------------------------------------------
  // PRIVATE
  // ----------------------------------------------------------

  private evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.memStore) {
      if (now > entry.expiresAt) this.memStore.delete(key);
    }
  }
}
