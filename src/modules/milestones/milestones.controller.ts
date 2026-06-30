import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import { MilestonesService } from './milestones.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { UpdateMilestoneStatusDto } from './dto/update-milestone-status.dto';

const ALLOWED_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
];

@ApiTags('milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseGuards(UserJwtSubThrottlerGuard)
@Throttle(100, 60)
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

  @Post(':index/evidence')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload dispute evidence file for a milestone (JPEG/PNG/GIF/PDF/MP4 ≤ 10 MB)' })
  @ApiParam({ name: 'index', type: Number })
  @ApiResponse({ status: 201, description: 'Evidence uploaded' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a party to this engagement' })
  async uploadEvidence(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${ALLOWED_EVIDENCE_MIME_TYPES.join(', ')}`,
      );
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 10 MB limit');
    }
    return this.milestonesService.uploadEvidence(engagementId, index, file, user);
  }
}
