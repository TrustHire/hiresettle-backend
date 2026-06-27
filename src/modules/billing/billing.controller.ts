import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.COMPANY)
@Controller('companies/me')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('billing')
  @ApiOperation({ summary: 'Get company billing summary (COMPANY role only)' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO format)' })
  getBillingSummary(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.billingService.getBillingSummary(user, fromDate, toDate);
  }

  @Get('billing/export.csv')
  @ApiOperation({ summary: 'Export billing data as CSV (COMPANY role only)' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO format)' })
  async exportBillingCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const csvContent = await this.billingService.exportBillingToCsv(user, fromDate, toDate);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="billing-export.csv"');
    res.status(HttpStatus.OK).send(csvContent);
  }
}
