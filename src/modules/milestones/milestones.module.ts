import { Module } from '@nestjs/common';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';
import { RetentionSchedulerService } from './retention-scheduler.service'; // Add this import

@Module({
  controllers: [MilestonesController],
  providers: [MilestonesService, RetentionSchedulerService], // Add it here
  exports: [MilestonesService],
})
export class MilestonesModule {}
