import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { TerminusModule } from "@nestjs/terminus";
import { BullModule } from "@nestjs/bullmq";
import { AppCacheModule } from "./common/cache/cache.module";
import { DistributedLockModule } from "./common/lock/distributed-lock.module";
import { envValidationSchema } from "./config/env.validation";
import { AppLoggerModule } from "./common/logger/logger.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { EtagInterceptor } from "./common/interceptors/etag.interceptor";
import { SecurityEventsModule } from "./common/security-events/security-events.module";
import { QueuesModule } from "./queues/queues.module";

import { MetricsModule } from "./metrics/metrics.module";
import { DataRetentionModule } from "./common/retention/data-retention.module";

import { PrismaModule } from "./common/prisma/prisma.module";
import { S3Module } from "./common/s3/s3.module";
import { PasswordPolicyModule } from "./common/password/password-policy.module";
import { HibpModule } from "./common/hibp/hibp.module";
import { StellarModule as CommonStellarModule } from "./common/stellar/stellar.module";
import { StellarModule } from "./modules/stellar/stellar.module";
import { MultisigModule } from "./modules/multisig/multisig.module";

import { AuthModule } from "./modules/auth/auth.module";
import { EngagementsModule } from "./modules/engagements/engagements.module";
import { EngagementTemplatesModule } from "./modules/engagement-templates/engagement-templates.module";
import { RecruitersModule } from "./modules/recruiters/recruiters.module";
import { MilestonesModule } from "./modules/milestones/milestones.module";
import { DisputesModule } from "./modules/disputes/disputes.module";
import { EventsModule } from "./modules/events/events.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UsersModule } from "./modules/users/users.module";
import { HealthModule } from "./modules/health/health.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AnnouncementsModule } from "./modules/announcements/announcements.module";
import { BillingModule } from "./modules/billing/billing.module";
import { TeamInvitesModule } from "./modules/team-invites/team-invites.module";
import { CompaniesModule } from "./modules/companies/companies.module";
import { GraphqlModule } from "./graphql/graphql.module";
import stellarConfig from "./config/stellar.config";
import { MaintenanceModeModule } from "./common/maintenance/maintenance-mode.module";
import { FeatureFlagsModule } from "./modules/feature-flags/feature-flags.module";
import { DevModuleFactory } from "./modules/dev/dev-module.factory";

export function shouldSkipThrottle(req: { path?: string; url?: string; originalUrl?: string }): boolean {
  const path = req.path ?? req.originalUrl?.split('?')[0] ?? req.url?.split('?')[0] ?? '';
  return path === '/health' || path === '/health/live' || path === '/health/ready' || path === '/status';
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [stellarConfig] }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: config.get<number>('THROTTLE_TTL', 60), limit: config.get<number>('THROTTLE_LIMIT', 100) }],
        skipIf: (context) => shouldSkipThrottle(context.switchToHttp().getRequest()),
      }),
    }),
    ScheduleModule.forRoot(),
    TerminusModule,
    AppCacheModule,
    DistributedLockModule,
    AppLoggerModule,
    SecurityEventsModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>("REDIS_URL", "redis://localhost:6379"),
        },
      }),
    }),
    QueuesModule,
    MetricsModule,
    DataRetentionModule,

    PrismaModule,
    SystemConfigModule,
    S3Module,
    PasswordPolicyModule,
    HibpModule,
    CommonStellarModule,
    StellarModule,
    MultisigModule,
    DevModuleFactory.register(),
    AuthModule,
    EngagementsModule,
    EngagementTemplatesModule,
    RecruitersModule,
    MilestonesModule,
    DisputesModule,
    EventsModule,
    NotificationsModule,
    UsersModule,
    HealthModule,
    AdminModule,
    AnnouncementsModule,
    BillingModule,
    TeamInvitesModule,
    CompaniesModule,
    EmailModule,
    GraphqlModule,
    FeatureFlagsModule,
    WellKnownModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: EtagInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
