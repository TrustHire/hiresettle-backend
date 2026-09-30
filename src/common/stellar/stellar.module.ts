import { Global, Module } from '@nestjs/common';
import { StellarService } from './stellar.service';
import { StellarController } from './stellar.controller';
import { AppCacheModule } from '../cache/cache.module';
import { HorizonFailoverService } from './horizon-failover.service';

@Global()
@Module({
  imports: [AppCacheModule],
  controllers: [StellarController],
  providers: [HorizonFailoverService, StellarService],
  exports: [StellarService, HorizonFailoverService],
})
export class StellarModule {}
