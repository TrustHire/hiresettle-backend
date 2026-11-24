import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AccountingCategory, CompanyRole, UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompanyRoles } from '../../common/decorators/company-roles.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccountingService } from './accounting.service';
import { ListSyncLogsQueryDto, UpsertAccountMappingDto } from './dto/accounting.dto';

const providerParam = { name: 'provider', enum: ['xero', 'quickbooks'] };

@ApiTags('accounting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
@Roles(UserRole.COMPANY)
@CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
@Controller('companies/me/accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get()
  @ApiOperation({ summary: 'List accounting connections' })
  list(@CurrentUser('id') companyId: string) {
    return this.accounting.listConnections(companyId);
  }

  @Get('sync-logs')
  @ApiOperation({ summary: 'Sync log: every bill pushed (or attempted) to the accounting system' })
  syncLogs(@CurrentUser('id') companyId: string, @Query() query: ListSyncLogsQueryDto) {
    return this.accounting.listSyncLogs(companyId, query);
  }

  @Get(':provider/connect')
  @CompanyRoles(CompanyRole.OWNER)
  @ApiParam(providerParam)
  @ApiOperation({ summary: 'Start the OAuth connection flow; redirect the browser to authorizeUrl' })
  connect(@CurrentUser('id') companyId: string, @Param('provider') provider: string) {
    return this.accounting.getConnectUrl(companyId, AccountingService.parseProvider(provider));
  }

  @Delete(':provider')
  @CompanyRoles(CompanyRole.OWNER)
  @ApiParam(providerParam)
  @ApiOperation({ summary: 'Disconnect; stops syncing and discards stored tokens' })
  disconnect(@CurrentUser('id') companyId: string, @Param('provider') provider: string) {
    return this.accounting.disconnect(companyId, AccountingService.parseProvider(provider));
  }

  @Get(':provider/mappings')
  @ApiParam(providerParam)
  @ApiOperation({ summary: 'List platform-category → account-code mappings' })
  mappings(@CurrentUser('id') companyId: string, @Param('provider') provider: string) {
    return this.accounting.listMappings(companyId, AccountingService.parseProvider(provider));
  }

  @Put(':provider/mappings')
  @ApiParam(providerParam)
  @ApiOperation({ summary: 'Map a platform category (PLATFORM_FEE, RECRUITER_FEE) to an account code' })
  upsertMapping(
    @CurrentUser('id') companyId: string,
    @Param('provider') provider: string,
    @Body() dto: UpsertAccountMappingDto,
  ) {
    return this.accounting.upsertMapping(companyId, AccountingService.parseProvider(provider), dto);
  }

  @Delete(':provider/mappings/:category')
  @ApiParam(providerParam)
  @ApiParam({ name: 'category', enum: AccountingCategory })
  deleteMapping(
    @CurrentUser('id') companyId: string,
    @Param('provider') provider: string,
    @Param('category') category: AccountingCategory,
  ) {
    return this.accounting.deleteMapping(companyId, AccountingService.parseProvider(provider), category);
  }

  @Post(':provider/sync')
  @HttpCode(HttpStatus.OK)
  @ApiParam(providerParam)
  @ApiOperation({ summary: 'Push pending documents now instead of waiting for the scheduled sync' })
  sync(@CurrentUser('id') companyId: string, @Param('provider') provider: string) {
    return this.accounting.syncNow(companyId, AccountingService.parseProvider(provider));
  }
}

/** Public OAuth redirect target. The signed `state` identifies the company. */
@ApiTags('accounting')
@Controller('accounting/oauth')
export class AccountingOAuthCallbackController {
  constructor(private readonly accounting: AccountingService) {}

  @Get(':provider/callback')
  @ApiExcludeEndpoint()
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    let parsed;
    try {
      parsed = AccountingService.parseProvider(provider);
    } catch {
      return res.status(404).send('Not found');
    }
    return res.redirect(302, await this.accounting.handleCallback(parsed, query));
  }
}
