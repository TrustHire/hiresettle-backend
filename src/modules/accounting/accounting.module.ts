import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DistributedLockModule } from '../../common/lock/distributed-lock.module';
import { AccountingController, AccountingOAuthCallbackController } from './accounting.controller';
import { AccountingClientFactory } from './accounting-providers';
import { AccountingService } from './accounting.service';

@Module({
  imports: [AuthModule, DistributedLockModule],
  controllers: [AccountingController, AccountingOAuthCallbackController],
  providers: [AccountingService, AccountingClientFactory],
})
export class AccountingModule {}
