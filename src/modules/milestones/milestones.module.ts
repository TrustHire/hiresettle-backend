import { Module } from '@nestjs/common';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { S3Module } from '../../common/s3/s3.module';

@Module({
  imports: [S3Module],
  controllers: [MilestonesController],
  providers: [MilestonesService, RetentionSchedulerService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
