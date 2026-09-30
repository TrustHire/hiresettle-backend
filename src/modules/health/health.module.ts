import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { QueueHealthIndicator } from './queue-health.indicator';
import { StatusController } from './status.controller';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { HorizonFailoverService } from '../../common/stellar/horizon-failover.service';
import { QUEUE_EMAIL } from '../../queues/queues.module';

@Module({
  imports: [
    TerminusModule,
    BullModule.registerQueue({ name: QUEUE_EMAIL }),
  ],
  controllers: [HealthController, StatusController],
  providers: [HealthService, QueueHealthIndicator, PrismaService, StellarService, HorizonFailoverService],
})
export class HealthModule {}
