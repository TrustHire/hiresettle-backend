import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { BulkCreateMilestonesDto } from './dto/bulk-create-milestones.dto';
import { SetPlacementDueDateDto } from './dto/set-placement-due-date.dto';
import { AdjustMilestonePercentsDto } from './dto/adjust-milestone-percents.dto';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { ProofVersionsService } from './proof-versions.service';
import { PartialReleaseService } from './partial-release.service';
import { ApproveMilestoneDto } from './dto/approve-milestone.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { RejectProofDto } from './dto/reject-proof.dto';
import { ProposePartialReleaseDto } from './dto/propose-partial-release.dto';

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
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('engagements/:engagementId/milestones')
export class MilestonesController {

  constructor(
    private readonly milestonesService: MilestonesService,
    private readonly proofVersions: ProofVersionsService,
    private readonly partialReleases: PartialReleaseService,
  ) { }

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

  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create multiple milestones on an engagement in one transactional call (COMPANY only)' })
  @ApiResponse({ status: 201, description: 'Milestones created successfully' })
  @ApiResponse({ status: 400, description: 'paymentPercent values do not sum to 100' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not the company party for this engagement' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  bulkCreate(
    @Param('engagementId') engagementId: string,
    @Body() dto: BulkCreateMilestonesDto,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.bulkCreate(engagementId, dto.milestones, user);
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

  @Post(':index/approve')
  @ApiOperation({ summary: 'Approve a milestone for confirmation (party only)' })
  @ApiResponse({ status: 200, description: 'Milestone approved successfully' })
  @ApiResponse({ status: 400, description: 'Milestone not in PROOF_SUBMITTED state or duplicate approval' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a party to this engagement' })
  @ApiResponse({ status: 404, description: 'Engagement or milestone not found' })
  @ApiResponse({ status: 409, description: 'proofVersion is not the latest proof version' })
  approve(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ApproveMilestoneDto,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.approveMilestone(engagementId, index, user, dto?.proofVersion);
  }

  @Put(':index/approve')
  @ApiOperation({ summary: 'Approve the latest proof version of a milestone (alias of POST)' })
  @ApiResponse({ status: 200, description: 'Milestone approved successfully' })
  @ApiResponse({ status: 409, description: 'proofVersion is not the latest proof version' })
  approvePut(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ApproveMilestoneDto,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.approveMilestone(engagementId, index, user, dto?.proofVersion);
  }

  // ----------------------------------------------------------
  // Proof versions (#376)
  // ----------------------------------------------------------

  @Post(':index/proof')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit or resubmit proof for a milestone (recruiter only); creates a new proof version' })
  @ApiResponse({ status: 201, description: 'Proof version recorded; milestone is PROOF_SUBMITTED' })
  @ApiResponse({ status: 403, description: 'Not the recruiter on this engagement' })
  @ApiResponse({ status: 422, description: 'Milestone is not PENDING' })
  submitProof(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SubmitProofDto,
    @CurrentUser() user: any,
  ) {
    return this.proofVersions.submitProof(engagementId, index, user, dto);
  }

  @Post(':index/proof/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject the latest proof version (company only); the recruiter can then resubmit' })
  @ApiResponse({ status: 200, description: 'Proof rejected; milestone back to PENDING' })
  @ApiResponse({ status: 403, description: 'Not the company on this engagement' })
  @ApiResponse({ status: 409, description: 'versionNumber is not the latest, or already reviewed' })
  rejectProof(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: RejectProofDto,
    @CurrentUser() user: any,
  ) {
    return this.proofVersions.rejectProof(engagementId, index, user, dto.reason, dto.versionNumber);
  }

  @Get(':index/proof-versions')
  @ApiOperation({ summary: 'Full proof submission history for a milestone, newest first' })
  @ApiResponse({ status: 200, description: 'Proof versions' })
  async proofHistory(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: any,
  ) {
    const milestone = await this.milestonesService.findOneForUser(engagementId, index, user);
    return milestone.proofVersions;
  }

  // ----------------------------------------------------------
  // Partial payment release (#378)
  // ----------------------------------------------------------

  @Get(':index/partial-releases')
  @ApiOperation({ summary: 'List partial release proposals for a milestone' })
  listPartialReleases(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: any,
  ) {
    return this.partialReleases.list(engagementId, index, user);
  }

  @Post(':index/partial-releases')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Propose releasing part of the milestone escrow (company or recruiter); counts as the proposer approval',
  })
  @ApiResponse({ status: 201, description: 'Proposal created; awaiting the other party' })
  @ApiResponse({ status: 400, description: 'Invalid split' })
  @ApiResponse({ status: 409, description: 'A proposal is already open' })
  proposePartialRelease(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ProposePartialReleaseDto,
    @CurrentUser() user: any,
  ) {
    return this.partialReleases.propose(engagementId, index, user, dto);
  }

  @Post(':index/partial-releases/:releaseId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a partial release; executes on-chain once both parties have approved' })
  @ApiResponse({ status: 200, description: 'Approval recorded (status EXECUTED once both parties approved)' })
  @ApiResponse({ status: 409, description: 'Already approved or no longer open' })
  approvePartialRelease(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Param('releaseId') releaseId: string,
    @CurrentUser() user: any,
  ) {
    return this.partialReleases.approve(engagementId, index, releaseId, user);
  }

  @Post(':index/partial-releases/:releaseId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an open partial release proposal' })
  rejectPartialRelease(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Param('releaseId') releaseId: string,
    @CurrentUser() user: any,
  ) {
    return this.partialReleases.reject(engagementId, index, releaseId, user);
  }

  @Post(':index/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ARBITER)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
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
    return this.milestonesService.resolveDisputeFlow(engagementId, index, dto.resolution, user);
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

  /**
   * PATCH /api/v1/engagements/:engagementId/milestones/:index/due-date
   * Set or clear the expected proof-submission date on a PLACEMENT milestone (#260).
   * Resets the reminderSent flag when the date changes.
   */
  @Patch(':index/due-date')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set or clear the placementDueAt date on a PLACEMENT milestone (#260)' })
  @ApiParam({ name: 'engagementId', description: 'Engagement ID' })
  @ApiParam({ name: 'index', type: Number, description: 'Milestone index' })
  @ApiResponse({ status: 200, description: 'Due date updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a party to this engagement' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  setDueDate(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetPlacementDueDateDto,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.setPlacementDueDate(engagementId, index, dto.placementDueAt, user);
  }

  /**
   * PATCH /api/v1/engagements/:engagementId/milestones/adjust-percents
   * Adjust paymentPercent values pre-confirmation; total must still sum to 100.
   * Records each change in the audit log (#261).
   */
  @Patch('adjust-percents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust milestone percentages pre-confirmation; total must sum to 100 (#261)' })
  @ApiParam({ name: 'engagementId', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Percentages adjusted' })
  @ApiResponse({ status: 400, description: 'Total does not sum to 100 or milestone already confirmed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement or milestone not found' })
  adjustPercents(
    @Param('engagementId') engagementId: string,
    @Body() dto: AdjustMilestonePercentsDto,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.adjustMilestonePercents(engagementId, dto.adjustments, dto.reason, user.id);
  }
}
