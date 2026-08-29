import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationCleanupService } from './notification-cleanup.service';
import { EmailTemplateModule } from '../../common/email/email-template.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
    EmailTemplateModule,
  ],
  providers: [NotificationsService, NotificationCleanupService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
