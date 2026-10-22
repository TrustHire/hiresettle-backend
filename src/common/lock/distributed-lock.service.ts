import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

/**
 * DistributedLockService
 *
 * Redis-backed distributed lock for scheduled jobs. When the app runs as
 * multiple replicas, only the instance that wins the lock for a given tick
 * executes the job — preventing duplicate reminders and reconciliation runs.
 *
 * Uses SET key token NX PX ttl to acquire a lock, and a Lua compare-and-delete
 * to release it safely (only the token owner can delete). If REDIS_URL is not
 * configured (single-instance), every acquire succeeds trivially.
 */
@Injectable()
export class DistributedLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);

  private redisClient?: any;
  private useRedis = false;

  // Lua script: delete the key only if the stored value matches our token.
  private static readonly RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (redisUrl) {
      try {
        // Dynamic require so the app starts without ioredis installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Redis = require('ioredis');
        this.redisClient = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
        });
        await this.redisClient.connect();
        this.useRedis = true;
        this.logger.log('DistributedLockService: connected to Redis');
      } catch (err) {
        this.logger.warn(
          `DistributedLockService: failed to connect to Redis (${(err as Error).message}). Locks will always succeed (single-instance mode).`,
        );
      }
    } else {
      this.logger.log('DistributedLockService: REDIS_URL not set — single-instance mode, locks always succeed');
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // best-effort disconnect
      }
    }
  }

  /**
   * Attempt to acquire a distributed lock.
   * @returns A token string if the lock was acquired, or null if another instance holds it.
   */
  async tryAcquireLock(key: string, ttlMs: number): Promise<string | null> {
    if (!this.useRedis || !this.redisClient) {
      return randomUUID(); // single-instance: always succeed
    }

    try {
      const token = randomUUID();
      const result = await this.redisClient.set(key, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') return token;

      this.logger.debug(`${key} — skipped, another instance holds the lock`);
      return null;
    } catch (err) {
      // Redis error — fail open so the job still runs on this instance
      this.logger.warn(`${key} — Redis error during acquire: ${(err as Error).message}. Lock granted (fail-open).`);
      return randomUUID();
    }
  }

  /**
   * Release a previously acquired lock. Only deletes if the stored token matches.
   */
  async releaseLock(key: string, token: string): Promise<void> {
    if (!this.useRedis || !this.redisClient) return;

    try {
      await this.redisClient.eval(DistributedLockService.RELEASE_SCRIPT, 1, key, token);
    } catch {
      // best-effort — TTL will expire the lock anyway
    }
  }

  /**
   * Convenience helper: acquire a lock, run the function, release the lock.
   * Returns undefined if the lock could not be acquired.
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const token = await this.tryAcquireLock(key, ttlMs);
    if (!token) return undefined;
    try {
      return await fn();
    } finally {
      await this.releaseLock(key, token);
    }
  }
}
