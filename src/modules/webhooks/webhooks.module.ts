import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhookSubscriptionsController } from './webhook-subscriptions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook' }),
    PrismaModule,
    IdempotencyModule,
    AuthModule,
  ],
  controllers: [WebhookSubscriptionsController],
  providers: [WebhooksService, WebhookSubscriptionsService, IdempotencyInterceptor],
  exports: [WebhooksService, WebhookSubscriptionsService],
})
export class WebhooksModule {}
