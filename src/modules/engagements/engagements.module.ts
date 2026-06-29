import { Module } from '@nestjs/common';
import { EngagementsController } from './engagements.controller';
import { EngagementsService } from './engagements.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [NotificationsModule, AdminModule, PrismaModule],
  controllers: [EngagementsController],
  providers: [EngagementsService, AuditLogService],
  exports: [EngagementsService, AuditLogService],
})
export class EngagementsModule {}
