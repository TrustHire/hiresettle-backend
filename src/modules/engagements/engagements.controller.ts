import {
  Controller, Get, Post, Body, Param,
  Query, UseGuards, HttpCode, HttpStatus,
  Patch, UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse,
  ApiBearerAuth, ApiQuery, ApiParam,
} from '@nestjs/swagger';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { User, UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { EngagementsService } from './engagements.service';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { UpdateEngagementStatusDto } from './dto/update-engagement-status.dto';
import { AuditLogService } from './audit-log.service';
import { AuditLogEntryDto } from './dto/audit-log-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { AdminUsersService } from '../admin/admin-users.service';
import { CancelEngagementDto } from './dto/cancel-engagement.dto';
import { RequestReplacementDto } from './dto/request-replacement.dto';
import { CreateEngagementNoteDto } from './dto/create-engagement-note.dto';

@ApiTags('engagements')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('engagements')
export class EngagementsController {
  constructor(
    private readonly engagementsService: EngagementsService,
    private readonly adminUsersService: AdminUsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create engagement with on-chain escrow (COMPANY only)' })
  @ApiResponse({ status: 201, description: 'Engagement created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateEngagementDto,
  ) {
    return this.engagementsService.create(user, dto);
  }

  /**
   * GET /api/v1/engagements
   * List with optional filters: search, status (single/multi), date range, pagination.
   */
  @Get()
  @ApiOperation({ summary: 'List engagements with flexible filters and pagination' })
  @ApiQuery({ name: 'companyAddress', required: false, description: 'Filter by company Stellar address' })
  @ApiQuery({ name: 'recruiterAddress', required: false, description: 'Filter by recruiter Stellar address' })
  @ApiQuery({ name: 'status', required: false, description: 'Single value or comma-separated (e.g., ACTIVE,COMPLETED)' })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive partial match on jobTitle' })
  @ApiQuery({ name: 'createdFrom', required: false, description: 'ISO date string (e.g., 2026-01-01)' })
  @ApiQuery({ name: 'createdTo', required: false, description: 'ISO date string (e.g., 2026-12-31)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ID of the last engagement from the previous page' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'amount', 'status'], description: 'Field to sort by (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort direction (default: desc)' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, description: 'Include archived engagements (default: false)' })
  @ApiResponse({ status: 200, description: 'Engagements list retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid sortBy or sortOrder value' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Query('companyAddress') companyAddress?: string,
    @Query('recruiterAddress') recruiterAddress?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('includeArchived') includeArchived?: boolean,
  ) {
    return this.engagementsService.findAll({
      companyAddress,
      recruiterAddress,
      status,
      search,
      createdFrom,
      createdTo,
      page,
      limit,
      cursor,
      sortBy,
      sortOrder,
      includeArchived,
    });
  }

  /**
   * GET /api/v1/engagements/:id
   * Full detail — milestones, events, retention schedule.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get full engagement details' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Engagement retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.engagementsService.findOne(id, user.id);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Get aggregated engagement summary' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Engagement summary retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  async getEngagementSummary(@Param('id') id: string, @CurrentUser() user: any) {
    return this.engagementsService.getSummary(id, user.id);
  }

  /**
   * GET /api/v1/engagements/:id/audit-log
   * Returns the full status transition history for an engagement.
   */
  @Get(':id/audit-log')
  @ApiOperation({ summary: 'Get engagement audit log' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Audit log retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  getAuditLog(
    @Param('id') engagementId: string,
    @CurrentUser() user: { id: string; role: string },
  ): Promise<AuditLogEntryDto[]> {
    return this.auditLogService.findByEngagement(engagementId, user.id, user.role);
  }

  /**
   * POST /api/v1/engagements/:id/notes
   * Add an internal note to an engagement (participants only).
   */
  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an internal note to an engagement (participants only)' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 201, description: 'Note created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a participant of this engagement' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  createNote(
    @Param('id') id: string,
    @Body() dto: CreateEngagementNoteDto,
    @CurrentUser() user: any,
  ) {
    return this.engagementsService.createNote(id, user, dto.body);
  }

  /**
   * GET /api/v1/engagements/:id/notes
   * List internal notes on an engagement (participants only).
   */
  @Get(':id/notes')
  @ApiOperation({ summary: 'List internal notes on an engagement (participants only)' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Notes retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a participant of this engagement' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  getNotes(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.engagementsService.findNotes(id, user);
  }

  /**
   * POST /api/v1/engagements/:id/sync
   * Force re-read the engagement from the Stellar chain.
   */
  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force sync engagement status from Stellar chain' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Engagement synced successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  sync(@Param('id') id: string) {
    return this.engagementsService.syncFromChain(id);
  }

  @Post(':id/recuse-arbiter')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ARBITER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recuse yourself as arbiter from an engagement (ARBITER only)' })
  recuseArbiter(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.engagementsService.recuseArbiter(id, user.id, user.role);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an engagement so it is excluded from default list views' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Engagement archived' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  @ApiResponse({ status: 409, description: 'Engagement is already archived' })
  archive(@Param('id') id: string) {
    return this.engagementsService.archive(id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived engagement back into default list views' })
  @ApiParam({ name: 'id', description: 'Engagement ID' })
  @ApiResponse({ status: 200, description: 'Engagement restored' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Engagement not found' })
  @ApiResponse({ status: 409, description: 'Engagement is not archived' })
  restore(@Param('id') id: string) {
    return this.engagementsService.restore(id);
  }

  @Get('arbiters')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY, UserRole.ADMIN)
  @ApiOperation({ summary: 'List all active arbiters (COMPANY and ADMIN only)' })
  listArbiters() {
    return this.adminUsersService.listArbiters();
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin override: Force update engagement status' })
  updateEngagementStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEngagementStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.engagementsService.updateEngagementStatusByAdmin(id, dto.status, dto.reason, adminId);
  }
}
