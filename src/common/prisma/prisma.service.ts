import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    super({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'stdout',
          level: 'error',
        },
        {
          emit: 'stdout',
          level: 'warn',
        },
      ],
      // Configure connection pooling for production
      datasources: {
        db: {
          url: configService?.get<string>('DATABASE_URL'),
        },
      },
      // Enable connection pooling with configurable pool sizes
      ...(configService && {
        // Only set transaction options in production
        ...(configService.get('NODE_ENV') === 'production' && {
          transactionOptions: {
            maxWait: 5000, // max wait time for a transaction
            timeout: 10000, // max time to process a transaction
          },
        }),
      }),
    });

    // Setup query logging in development
    if (configService?.get('NODE_ENV') === 'development') {
      this.$on('query' as never, (event: any) => {
        this.logger.debug(`Query: ${event.query} | Duration: ${event.duration}ms`);
      });
    }

    // Setup slow query logging in all environments
    this.$on('query' as never, (event: any) => {
      if (event.duration > 500) {
        this.logger.warn(`Slow query detected: ${event.query} | Duration: ${event.duration}ms`);
      }
    });
  }

  async onModuleInit() {
    if (this.metrics) {
      this.$use(async (params, next) => {
        const start = Date.now();
        const result = await next(params);
        const duration = Date.now() - start;
        this.metrics!.recordDbQuery(params.model ?? 'unknown', params.action, duration);
        
        // Log slow queries for monitoring
        if (duration > 500) {
          this.logger.warn(`Slow query detected: ${params.model}.${params.action} took ${duration}ms`);
        }
        
        return result;
      });
    }
    
    await this.$connect();
    
    // Log connection pool information
    const poolMin = this.configService?.get<number>('DATABASE_POOL_MIN', 2);
    const poolMax = this.configService?.get<number>('DATABASE_POOL_MAX', 10);
    this.logger.log(`Database connected with connection pool: min=${poolMin}, max=${poolMax}`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
