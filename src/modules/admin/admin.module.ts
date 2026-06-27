import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [NotificationsModule, PrismaModule],
  controllers: [AdminController],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminModule {}
