import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { MilestonesModule } from '../milestones/milestones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { WebhooksModule } from '../webhooks/webhooks.module'; // Add this import

@Module({
  imports: [
    MilestonesModule,
    NotificationsModule,
    EngagementsModule,
    WebhooksModule, // Add it here
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
