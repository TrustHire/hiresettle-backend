import {
  Controller, Get, Post, Body, Param, Patch, Delete,
  UseGuards, HttpCode, HttpStatus,
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
}
