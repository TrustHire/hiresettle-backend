import { Module } from '@nestjs/common';
import { StellarController } from './stellar.controller';
import { StellarModule as CommonStellarModule } from '../../common/stellar/stellar.module';

@Module({
  imports: [CommonStellarModule],
  controllers: [StellarController],
  providers: [],
})
export class StellarModule {}
