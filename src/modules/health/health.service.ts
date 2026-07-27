import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isDatabaseHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('database');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (e) {
      this.logger.error('Database health check failed', e.message);
      return indicator.down({ message: e.message });
    }
  }

  async isStellarHorizonHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('stellarHorizon');
    try {
      await this.stellar.getLatestLedger();
      return indicator.up();
    } catch (e) {
      this.logger.warn('Stellar Horizon health check degraded', e.message);
      return indicator.down({ message: e.message });
    }
  }
}
