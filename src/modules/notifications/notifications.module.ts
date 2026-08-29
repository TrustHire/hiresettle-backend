import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationCleanupService } from './notification-cleanup.service';
import { SlackNotificationsService } from './slack-notifications.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'slack' }),
  ],
  providers: [NotificationsService, NotificationCleanupService, SlackNotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService, SlackNotificationsService],
})
export class NotificationsModule {}
