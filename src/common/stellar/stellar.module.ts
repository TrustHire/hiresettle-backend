import { Global, Module } from '@nestjs/common';
import { StellarService } from './stellar.service';
import { StellarController } from './stellar.controller';
import { AppCacheModule } from '../cache/cache.module';

@Global()
@Module({
  imports: [AppCacheModule],
  controllers: [StellarController],
  providers: [StellarService],
  exports: [StellarService],
})
export class StellarModule {}
