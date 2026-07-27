import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminDeadLetterService } from './admin-dead-letter.service';
import { AdminReportsService } from './admin-reports.service';
import { StellarMergeDetectorService } from './stellar-merge-detector.service';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [NotificationsModule, PrismaModule, UsersModule],
  controllers: [AdminController],
  providers: [
    AdminUsersService,
    AdminDeadLetterService,
    AdminReportsService,
    StellarMergeDetectorService,
    AdminAuditLogsService,
  ],
  exports: [AdminUsersService],
})
export class AdminModule {}
