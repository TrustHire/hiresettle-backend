import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CompanyRole, UserRole } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompanyRoles } from '../../common/decorators/company-roles.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AtsService } from './ats.service';
import { CreateAtsIntegrationDto, CreateAtsMappingDto, RotateAtsSecretDto } from './dto/ats.dto';

@ApiTags('ats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
@Roles(UserRole.COMPANY)
@CompanyRoles(CompanyRole.OWNER)
@Controller('companies/me/ats-integrations')
export class AtsIntegrationsController {
  constructor(private readonly ats: AtsService) {}

  @Post()
  @ApiOperation({ summary: 'Connect Greenhouse or Lever. Returns the webhook URL and secret (shown once).' })
  create(@CurrentUser('id') companyId: string, @Body() dto: CreateAtsIntegrationDto) {
    return this.ats.createIntegration(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List ATS integrations' })
  list(@CurrentUser('id') companyId: string) {
    return this.ats.listIntegrations(companyId);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace the webhook signing secret' })
  rotate(@CurrentUser('id') companyId: string, @Param('id') id: string, @Body() dto: RotateAtsSecretDto) {
    return this.ats.rotateSecret(companyId, id, dto.secret);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  enable(@CurrentUser('id') companyId: string, @Param('id') id: string) {
    return this.ats.setEnabled(companyId, id, true);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop accepting webhooks without deleting mappings' })
  disable(@CurrentUser('id') companyId: string, @Param('id') id: string) {
    return this.ats.setEnabled(companyId, id, false);
  }

  @Delete(':id')
  remove(@CurrentUser('id') companyId: string, @Param('id') id: string) {
    return this.ats.deleteIntegration(companyId, id);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Recent inbound webhook events and what each one did' })
  @ApiQuery({ name: 'limit', required: false })
  events(@CurrentUser('id') companyId: string, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.ats.listEvents(companyId, id, limit ? Number(limit) || 50 : 50);
  }

  @Post(':id/mappings')
  @ApiOperation({ summary: 'Map an ATS job and/or candidate to an engagement' })
  createMapping(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: CreateAtsMappingDto) {
    return this.ats.createMapping({ id: user.id, stellarAddress: user.stellarAddress }, id, dto);
  }

  @Get(':id/mappings')
  listMappings(@CurrentUser('id') companyId: string, @Param('id') id: string) {
    return this.ats.listMappings(companyId, id);
  }

  @Delete(':id/mappings/:mappingId')
  deleteMapping(
    @CurrentUser('id') companyId: string,
    @Param('id') id: string,
    @Param('mappingId') mappingId: string,
  ) {
    return this.ats.deleteMapping(companyId, id, mappingId);
  }
}

/** Public endpoint called by Greenhouse / Lever. Authenticated by HMAC signature only. */
@ApiTags('ats')
@SkipThrottle()
@Controller('ats/webhooks')
export class AtsWebhooksController {
  constructor(private readonly ats: AtsService) {}

  @Post(':integrationId')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  receive(
    @Param('integrationId') integrationId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    return this.ats.handleWebhook(integrationId, req.rawBody, headers, body);
  }
}
