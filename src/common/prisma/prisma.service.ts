import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Optional() private readonly metrics?: MetricsService) {
    super();
  }

  async onModuleInit() {
    if (this.metrics) {
      this.$use(async (params, next) => {
        const start = Date.now();
        const result = await next(params);
        this.metrics!.recordDbQuery(params.model ?? 'unknown', params.action, Date.now() - start);
        return result;
      });
    }
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
