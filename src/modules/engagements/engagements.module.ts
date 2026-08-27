import { Module } from '@nestjs/common';
import { EngagementsController } from './engagements.controller';
import { EngagementsService } from './engagements.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditLogService } from './audit-log.service';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@Module({
  imports: [NotificationsModule, AdminModule, PrismaModule, IdempotencyModule],
  controllers: [EngagementsController],
  providers: [EngagementsService, AuditLogService, IdempotencyInterceptor],
  exports: [EngagementsService, AuditLogService],
})
export class EngagementsModule {}
