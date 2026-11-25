import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AtsIntegrationsController, AtsWebhooksController } from './ats.controller';
import { AtsService } from './ats.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AtsIntegrationsController, AtsWebhooksController],
  providers: [AtsService],
})
export class AtsModule {}
