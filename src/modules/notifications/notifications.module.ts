import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationCleanupService } from './notification-cleanup.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
  ],
  providers: [NotificationsService, NotificationCleanupService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
