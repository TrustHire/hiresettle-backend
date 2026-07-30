import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  ThrottlerOptions,
  ThrottlerGetTrackerFunction,
  ThrottlerGenerateKeyFunction,
} from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Throttle key: JWT sub (user id) instead of IP.
 * Assumes JwtAuthGuard/Passport has already populated req.user.
 */
@Injectable()
export class UserJwtSubThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user;
    const sub = user?.id;
    return sub ? `sub:${sub}` : 'anonymous';
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: ThrottlerGetTrackerFunction,
    generateKey: ThrottlerGenerateKeyFunction,
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    const effectiveLimit = userId ? await this.resolveLimit(userId, limit) : limit;
    return super.handleRequest(context, effectiveLimit, ttl, throttler, getTracker, generateKey);
  }

  private async resolveLimit(userId: string, defaultLimit: number): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rateLimitOverride: true },
    });
    return user?.rateLimitOverride ?? defaultLimit;
  }
}
