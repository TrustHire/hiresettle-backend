import { Module } from '@nestjs/common';
import { EngagementTemplatesController } from './engagement-templates.controller';
import { EngagementTemplatesService } from './engagement-templates.service';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@Module({
  imports: [IdempotencyModule],
  controllers: [EngagementTemplatesController],
  providers: [EngagementTemplatesService, IdempotencyInterceptor],
  exports: [EngagementTemplatesService],
})
export class EngagementTemplatesModule {}
