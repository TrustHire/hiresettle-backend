import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { HorizonIndexerService } from './horizon-indexer.service';
import { ChainEventRetryService } from './chain-event-retry.service';
import { MilestonesModule } from '../milestones/milestones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    MilestonesModule,
    NotificationsModule,
    EngagementsModule,
    WebhooksModule,
  ],
  controllers: [EventsController],
  providers: [EventsService, HorizonIndexerService, ChainEventRetryService],
  exports: [EventsService],
})
export class EventsModule {}
