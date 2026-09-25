import { Module } from '@nestjs/common';
import { StellarController } from './stellar.controller';
import { StellarModule as CommonStellarModule } from '../../common/stellar/stellar.module';
import { AppCacheModule } from '../../common/cache/cache.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StellarTxStatusService } from './stellar-tx-status.service';
import { FeeSponsorshipService } from './fee-sponsorship.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CommonStellarModule, AppCacheModule, PrismaModule, AuthModule],
  controllers: [StellarController],
  providers: [StellarTxStatusService, FeeSponsorshipService],
  exports: [StellarTxStatusService, FeeSponsorshipService],
})
export class StellarModule {}
