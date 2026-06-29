import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { AppCacheModule } from './common/cache/cache.module';
import { QueuesModule } from './queues/queues.module';


import { PrismaModule } from './common/prisma/prisma.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ttl: config.get<number>('THROTTLE_TTL', 60),
        limit: config.get<number>('THROTTLE_LIMIT', 100),
        ignoreRoutes: ['/health'],
      }),
    }),
    ScheduleModule.forRoot(),
    TerminusModule,
    AppCacheModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL', 'redis://localhost:6379') },
      }),
    }),
    QueuesModule,

    PrismaModule,
    CommonStellarModule,
    StellarModule,
    AuthModule,
    EngagementsModule,
    RecruitersModule,
    MilestonesModule,
    EventsModule,
    NotificationsModule,
    UsersModule,
    HealthModule,
    AdminModule,
    BillingModule,
  ],
})
export class AppModule {}
