import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { AppCacheModule } from './common/cache/cache.module';
import { envValidationSchema } from './config/env.validation';
import { AppLoggerModule } from './common/logger/logger.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { SecurityEventsModule } from './common/security-events/security-events.module';
import { QueuesModule } from './queues/queues.module';

import { MetricsModule } from './metrics/metrics.module';
import { DataRetentionModule } from './common/retention/data-retention.module';

import { PrismaModule } from './common/prisma/prisma.module';
import { S3Module } from './common/s3/s3.module';
import { StellarModule as CommonStellarModule } from './common/stellar/stellar.module';
import { StellarModule } from './modules/stellar/stellar.module';

import { AuthModule } from './modules/auth/auth.module';
import { EngagementsModule } from './modules/engagements/engagements.module';
import { EngagementTemplatesModule } from './modules/engagement-templates/engagement-templates.module';
import { RecruitersModule } from './modules/recruiters/recruiters.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { BillingModule } from './modules/billing/billing.module';
import stellarConfig from './config/stellar.config';
import { MaintenanceModeModule } from './common/maintenance/maintenance-mode.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [stellarConfig] }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: config.get<number>('THROTTLE_TTL', 60), limit: config.get<number>('THROTTLE_LIMIT', 100) }],
        skipIf: (context) => context.switchToHttp().getRequest().url === '/health',
      }),
    }),
    ScheduleModule.forRoot(),
    TerminusModule,
    AppCacheModule,
    AppLoggerModule,
    SecurityEventsModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL', 'redis://localhost:6379') },
      }),
    }),
    QueuesModule,
    MetricsModule,
    DataRetentionModule,

    PrismaModule,
    S3Module,
    CommonStellarModule,
    StellarModule,
    AuthModule,
    EngagementsModule,
    EngagementTemplatesModule,
    RecruitersModule,
    MilestonesModule,
    EventsModule,
    NotificationsModule,
    UsersModule,
    HealthModule,
    AdminModule,
    BillingModule,
    MaintenanceModeModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
