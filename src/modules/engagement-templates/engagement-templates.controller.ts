import {
  Controller, Get, Post, Body, Param, Patch, Delete,
  UseGuards, HttpCode, HttpStatus, UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { EngagementTemplatesService } from './engagement-templates.service';
import { CreateEngagementTemplateDto } from './dto/create-engagement-template.dto';
import { UpdateEngagementTemplateDto } from './dto/update-engagement-template.dto';
import { CloneEngagementTemplateDto } from './dto/clone-engagement-template.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, User } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@ApiTags('engagement-templates')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('engagement-templates')
export class EngagementTemplatesController {
  constructor(private readonly templatesService: EngagementTemplatesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create a new engagement template (COMPANY only)' })
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateEngagementTemplateDto,
  ) {
    return this.templatesService.create(user.id, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'List all templates for the current company' })
  findAll(@CurrentUser() user: User) {
    return this.templatesService.findAll(user.id);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'Get a single template' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  findOne(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.templatesService.findOne(id, user.id);
  }

  @Get(':id/versions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'List version history for a template' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  findVersions(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.templatesService.findVersions(id, user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'Update a template (creates a new version rather than mutating the original)' })
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateEngagementTemplateDto,
  ) {
    return this.templatesService.update(id, user.id, dto);
  }

  @Post(':id/clone')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Clone a template into a new, independent template' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  clone(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CloneEngagementTemplateDto,
  ) {
    return this.templatesService.clone(id, user.id, dto?.name);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a template' })
  remove(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.templatesService.remove(id, user.id);
  }

  // Issue #265 — Template usage analytics
  @Get(':id/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'Get usage stats for a template (usageCount, lastUsedAt) (#265)' })
  @ApiResponse({ status: 200, description: 'Stats retrieved' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  getStats(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.templatesService.getStats(id, user.id);
  }

  // Issue #264 — Template export
  @Get(':id/export')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'Export a template as portable JSON (#264)' })
  @ApiResponse({ status: 200, description: 'Template JSON' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  exportTemplate(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.templatesService.exportTemplate(id, user.id);
  }

  // Issue #264 — Template import
  @Post('import')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Import a template from portable JSON (#264)' })
  @ApiResponse({ status: 201, description: 'Template created from import' })
  @ApiResponse({ status: 400, description: 'Invalid import payload' })
  importTemplate(
    @CurrentUser() user: User,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.templatesService.importTemplate(user.id, payload);
  }
}
