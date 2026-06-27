import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  async isDatabaseHealthy(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch (e) {
      this.logger.error('Database health check failed', e.message);
      return { database: { status: 'down', message: e.message } };
    }
  }

  async isStellarHorizonHealthy(): Promise<HealthIndicatorResult> {
    try {
      await this.stellar.getLatestLedger();
      return { stellarHorizon: { status: 'up' } };
    } catch (e) {
      this.logger.warn('Stellar Horizon health check degraded', e.message);
      return { stellarHorizon: { status: 'degraded', message: e.message } };
    }
  }
}
