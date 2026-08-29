import { Module } from '@nestjs/common';
import { MilestonesController } from './milestones.controller';
import { MilestoneDetailController } from './milestone-detail.controller';
import { AdminDisputesController } from './admin-disputes.controller';
import { AdminMilestonesController } from './admin-milestones.controller';
import { MilestonesService } from './milestones.service';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { S3Module } from '../../common/s3/s3.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@Module({
  imports: [S3Module, EngagementsModule, IdempotencyModule],
  controllers: [
    MilestonesController, MilestoneDetailController, AdminDisputesController, AdminMilestonesController,
  ],
  providers: [MilestonesService, RetentionSchedulerService, IdempotencyInterceptor],
  exports: [MilestonesService],
})
export class MilestonesModule {}
