import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook' }),
  ],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
