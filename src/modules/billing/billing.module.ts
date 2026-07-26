import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController, BillingExportController } from './billing.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController, BillingExportController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
