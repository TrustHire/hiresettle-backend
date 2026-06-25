import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';

import { PrismaModule } from './common/prisma/prisma.module';
import { StellarModule } from './common/stellar/stellar.module';

import { AuthModule } from './modules/auth/auth.module';
import { EngagementsModule } from './modules/engagements/engagements.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
          limit: config.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
    }),

    ScheduleModule.forRoot(),
    TerminusModule,

    PrismaModule,
    StellarModule,

    AuthModule,
    EngagementsModule,
    MilestonesModule,
    EventsModule,
    NotificationsModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
