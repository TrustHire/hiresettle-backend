import { Module } from '@nestjs/common';
import { MilestonesController } from './milestones.controller';
import { MilestoneDetailController } from './milestone-detail.controller';
import { MilestonesService } from './milestones.service';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { S3Module } from '../../common/s3/s3.module';
import { EngagementsModule } from '../engagements/engagements.module';

@Module({
  imports: [S3Module, EngagementsModule],
  controllers: [MilestonesController, MilestoneDetailController],
  providers: [MilestonesService, RetentionSchedulerService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
