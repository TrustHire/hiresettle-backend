// notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationCleanupService } from './notification-cleanup.service';

@Module({
  providers: [NotificationsService, NotificationCleanupService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
