import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController, BillingExportController } from './billing.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController, BillingExportController],
  providers: [BillingService, CompanyRoleGuard],
  exports: [BillingService],
})
export class BillingModule {}
