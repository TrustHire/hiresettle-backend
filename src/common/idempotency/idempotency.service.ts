import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up a previously cached response for the given key + user pair.
   * Returns the cached response object if one exists and has not yet expired,
   * or `null` if no valid entry is found (i.e. the caller should proceed
   * normally and then call `store()` afterwards).
   */
  async checkAndReturn(key: string, userId: string): Promise<unknown | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key_userId: { key, userId } },
    });
    if (existing && existing.expiresAt > new Date()) {
      return existing.response;
    }
    return null;
  }

  /**
   * Persist the response for a completed request so that future retries with
   * the same key + user pair short-circuit to this cached value.
   *
   * Uses `upsert` so that a race between two simultaneous first-requests with
   * the same key does not throw a unique-constraint violation.
   */
  async store(key: string, userId: string, response: unknown): Promise<void> {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS);
    await this.prisma.idempotencyKey.upsert({
      where: { key_userId: { key, userId } },
      create: { key, userId, response, expiresAt },
      update: { response, expiresAt },
    });
  }
}
