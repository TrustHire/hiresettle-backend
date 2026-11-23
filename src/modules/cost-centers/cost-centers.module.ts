import { Module } from '@nestjs/common';
import { CostCentersController } from './cost-centers.controller';
import { CostCentersService } from './cost-centers.service';

@Module({
  controllers: [CostCentersController],
  providers: [CostCentersService],
  exports: [CostCentersService],
})
export class CostCentersModule {}
