import { Module } from '@nestjs/common';
import { MilestonesController } from './milestones.controller';
import { MilestoneDetailController } from './milestone-detail.controller';
import { AdminDisputesController } from './admin-disputes.controller';
import { AdminMilestonesController } from './admin-milestones.controller';
import { MilestonesService } from './milestones.service';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { ProofVersionsService } from './proof-versions.service';
import { MilestoneProofSlaService } from './milestone-proof-sla.service';
import { PartialReleaseService } from './partial-release.service';
import { MilestoneCommentsService } from './milestone-comments.service';
import { MilestoneCommentsController } from './milestone-comments.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { S3Module } from '../../common/s3/s3.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { DisputesModule } from '../disputes/disputes.module';

@Module({
  imports: [S3Module, EngagementsModule, IdempotencyModule, DisputesModule],
  controllers: [
    MilestonesController, MilestoneDetailController, AdminDisputesController, AdminMilestonesController,
    MilestoneCommentsController,
  ],
  providers: [
    MilestonesService, RetentionSchedulerService, IdempotencyInterceptor,
    ProofVersionsService, MilestoneProofSlaService, PartialReleaseService, MilestoneCommentsService,
  ],
  exports: [MilestonesService],
})
export class MilestonesModule {}
