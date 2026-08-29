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
  public readonly replica: PrismaClient;

  constructor(
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    const prismaOptions = {
      log: [
        {
          emit: 'event' as const,
          level: 'query' as const,
        },
        {
          emit: 'stdout' as const,
          level: 'error' as const,
        },
        {
          emit: 'stdout' as const,
          level: 'warn' as const,
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
    };
    super(prismaOptions);

    const replicaUrl = configService?.get<string>('DATABASE_REPLICA_URL');
    if (replicaUrl) {
      this.logger.log('Initializing database replica client');
      this.replica = new PrismaClient({
        ...prismaOptions,
        datasources: {
          db: {
            url: replicaUrl,
          },
        },
      });
    } else {
      this.replica = this;
    }

    const setupLogging = (client: any, prefix: string) => {
      // Setup query logging in development
      if (configService?.get('NODE_ENV') === 'development') {
        client.$on('query', (event: any) => {
          this.logger.debug(`[${prefix}] Query: ${event.query} | Duration: ${event.duration}ms`);
        });
      }
  
      // Setup slow query logging in all environments
      client.$on('query', (event: any) => {
        if (event.duration > 500) {
          this.logger.warn(`[${prefix}] Slow query detected: ${event.query} | Duration: ${event.duration}ms`);
        }
      });
    };

    setupLogging(this, 'Primary');
    if (this.replica !== this) {
      setupLogging(this.replica, 'Replica');
    }
  }

  async onModuleInit() {
    if (this.metrics) {
      const setupMetrics = (client: any, prefix: string) => {
        client.$use(async (params: any, next: any) => {
          const start = Date.now();
          const result = await next(params);
          const duration = Date.now() - start;
          this.metrics!.recordDbQuery(params.model ?? 'unknown', params.action, duration);
          
          // Log slow queries for monitoring
          if (duration > 500) {
            this.logger.warn(`[${prefix}] Slow query detected: ${params.model}.${params.action} took ${duration}ms`);
          }
          
          return result;
        });
      };
      
      setupMetrics(this, 'Primary');
      if (this.replica !== this) {
        setupMetrics(this.replica, 'Replica');
      }
    }
    
    await this.$connect();
    if (this.replica !== this) {
      await this.replica.$connect();
    }
    
    // Log connection pool information
    const poolMin = this.configService?.get<number>('DATABASE_POOL_MIN', 2);
    const poolMax = this.configService?.get<number>('DATABASE_POOL_MAX', 10);
    this.logger.log(`Database connected with connection pool: min=${poolMin}, max=${poolMax}`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (this.replica !== this) {
      await this.replica.$disconnect();
    }
  }
}
