import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhookSubscriptionsController } from './webhook-subscriptions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook' }),
    PrismaModule,
  ],
  controllers: [WebhookSubscriptionsController],
  providers: [WebhooksService, WebhookSubscriptionsService],
  exports: [WebhooksService, WebhookSubscriptionsService],
})
export class WebhooksModule {}
