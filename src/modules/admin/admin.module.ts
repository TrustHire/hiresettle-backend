import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminDeadLetterService } from './admin-dead-letter.service';
import { AdminReportsService } from './admin-reports.service';
import { StellarMergeDetectorService } from './stellar-merge-detector.service';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminWebhooksService } from './admin-webhooks.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceModeModule } from '../../common/maintenance/maintenance-mode.module';
import { StellarBalanceAlertService } from './stellar-balance-alert.service';

@Module({
  imports: [NotificationsModule, PrismaModule, UsersModule, WebhooksModule, AuthModule, MaintenanceModeModule],
  controllers: [AdminController],
  providers: [
    AdminUsersService,
    AdminDeadLetterService,
    AdminReportsService,
    StellarMergeDetectorService,
    AdminAuditLogsService,
    AdminWebhooksService,
    StellarBalanceAlertService,
  ],
  exports: [AdminUsersService],
})
export class AdminModule {}
