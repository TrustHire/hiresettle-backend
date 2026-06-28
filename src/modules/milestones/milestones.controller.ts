import { Controller, Get, Param, ParseIntPipe, UseGuards, Patch, UnprocessableEntityException, Post, UseInterceptors, UploadedFile, ForbiddenException, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiResponse, ApiParam } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UpdateMilestoneStatusDto } from './dto/update-milestone-status.dto';

@ApiTags('milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseGuards(UserJwtSubThrottlerGuard)
@Throttle({ limit: 100, ttl: 60 })
@Controller('engagements/:engagementId/milestones')
export class MilestonesController {

  constructor(private readonly milestonesService: MilestonesService) { }

  @Get()
  @ApiOperation({ summary: 'List all milestones for an engagement (parties only)' })
  @ApiResponse({ status: 200, description: 'Milestones retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a party to this engagement' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  findAll(
    @Param('engagementId') engagementId: string,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.findByEngagementForUser(engagementId, user);
  }

  @Get(':index')
  @ApiOperation({ summary: 'Get a single milestone by index (parties only)' })
  @ApiResponse({ status: 200, description: 'Milestone retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a party to this engagement' })
  @ApiResponse({ status: 404, description: 'Engagement or milestone not found' })
  findOne(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.findOneForUser(engagementId, index, user);
  }

  @Get(':index/timer')
  @ApiOperation({ summary: 'Get retention countdown timer for a Locked milestone' })
  @ApiResponse({ status: 200, description: 'Timer retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Milestone not in Locked state' })
  getTimer(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.milestonesService.getRetentionTimer(engagementId, index);
  }

  @Post(':index/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ARBITER)
  @ApiOperation({ summary: 'Resolve a dispute on a milestone (arbiter only)' })
  @ApiResponse({ status: 200, description: 'Dispute resolved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  resolveDispute(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.resolveDisputeFlow(engagementId, index, dto.resolution);
  }

  @Patch(':index/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin override: Force update milestone status' })
  updateMilestoneStatus(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: UpdateMilestoneStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.milestonesService.updateMilestoneStatusByAdmin(
      engagementId,
      index,
      dto.status,
      dto.reason,
      adminId,
    );
  }
}
