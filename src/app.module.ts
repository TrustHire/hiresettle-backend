import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from '@nestjs/cache-manager';


import { PrismaModule } from './common/prisma/prisma.module';
import { StellarModule as CommonStellarModule } from './common/stellar/stellar.module';
import { StellarModule } from './modules/stellar/stellar.module';

import { AuthModule } from './modules/auth/auth.module';
import { EngagementsModule } from './modules/engagements/engagements.module';
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
    CacheModule.register({
      ttl: 10000, // default cache time in milliseconds
      max: 100, // maximum number of items in cache
    }),

    PrismaModule,
    CommonStellarModule,
    StellarModule,
    AuthModule,
    EngagementsModule,
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
