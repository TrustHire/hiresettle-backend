import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { AppealService } from './appeal.service';
import { ArbiterAssignmentService } from './arbiter-assignment.service';
import { DisputeSlaService } from './dispute-sla.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DisputesController],
  providers: [DisputesService, AppealService, ArbiterAssignmentService, DisputeSlaService],
  exports: [DisputesService, ArbiterAssignmentService],
})
export class DisputesModule {}
