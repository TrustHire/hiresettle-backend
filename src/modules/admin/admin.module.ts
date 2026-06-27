import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  controllers: [AdminController],
  providers: [AdminUsersService],
})
export class AdminModule {}
