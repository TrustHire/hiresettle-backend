import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Query,
  UseGuards,
  Patch,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { SecurityEventAction, UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminUsersService } from './admin-users.service';
import { AdminDeadLetterService } from './admin-dead-letter.service';
import { AdminReportsService } from './admin-reports.service';
import { StellarMergeDetectorService } from './stellar-merge-detector.service';
import { ListUsersDto } from './dto/list-users.dto';
import { AssignArbiterDto } from './dto/assign-arbiter.dto';
import { CacheService } from '../../common/cache/cache.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';
import { ListSecurityEventsDto } from '../../common/security-events/dto/list-security-events.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly deadLetter: AdminDeadLetterService,
    private readonly cacheService: CacheService,
    private readonly reports: AdminReportsService,
    private readonly mergeDetector: StellarMergeDetectorService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'List / search users (admin only)' })
  @ApiResponse({ status: 200, description: 'Users list retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminUsers.listUsers(dto);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Deactivate a user (soft delete)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivateUser(@Param('id') id: string, @Req() req: Request) {
    const result = await this.adminUsers.deactivateUser(id);
    await this.securityEvents.log({
      userId: (req.user as any)?.id,
      action: SecurityEventAction.ADMIN_OVERRIDE,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post('users/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User reactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User already active' })
  async reactivateUser(@Param('id') id: string, @Req() req: Request) {
    const result = await this.adminUsers.reactivateUser(id);
    await this.securityEvents.log({
      userId: (req.user as any)?.id,
      action: SecurityEventAction.ADMIN_OVERRIDE,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Patch('engagements/:id/arbiter')
  @ApiOperation({ summary: 'Assign or reassign an arbiter to an engagement' })
  assignArbiter(@Param('id') id: string, @Body() dto: AssignArbiterDto) {
    return this.adminUsers.assignArbiter(id, dto.arbiterId);
  }

  @Get('arbiters')
  @ApiOperation({ summary: 'List all active arbiters' })
  listArbiters() {
    return this.adminUsers.listArbiters();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get admin metrics including arbiter workload' })
  getMetrics() {
    return this.adminUsers.getAdminMetrics();
  }

  @Get('dead-letter-events')
  @ApiOperation({ summary: 'List dead-letter events (ADMIN only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dead-letter events retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listDeadLetterEvents(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.deadLetter.list(Number(page) || 1, Number(limit) || 20);
  }

  @Post('cache/flush')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flush all cache keys (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Cache flushed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async flushCache() {
    await this.cacheService.flush();
    return { message: 'Cache flushed successfully' };
  }

  @Post('dead-letter-events/:id/requeue')
  @ApiOperation({
    summary:
      'Requeue a dead-letter event back into chain_events for retry (ADMIN only)',
  })
  @ApiParam({ name: 'id', description: 'Dead-letter event ID' })
  @ApiResponse({ status: 201, description: 'Event requeued' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Dead-letter event not found' })
  requeueDeadLetterEvent(@Param('id') id: string) {
    return this.deadLetter.requeue(id);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #62 — Admin reports / CSV export
  // ────────────────────────────────────────────────────────────────

  @Get('reports/engagements.csv')
  @ApiOperation({
    summary: 'Export engagements as CSV for a date range (max 90 days)',
  })
  @ApiQuery({
    name: 'from',
    required: true,
    description: 'Start date (ISO 8601)',
  })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'CSV stream' })
  @ApiResponse({ status: 400, description: 'Invalid or missing date range' })
  streamEngagementsCsv(
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    return this.reports.streamEngagementsCsv(from, to, res);
  }

  @Get('reports/payments.csv')
  @ApiOperation({
    summary: 'Export released payments as CSV for a date range (max 90 days)',
  })
  @ApiQuery({
    name: 'from',
    required: true,
    description: 'Start date (ISO 8601)',
  })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'CSV stream' })
  @ApiResponse({ status: 400, description: 'Invalid or missing date range' })
  streamPaymentsCsv(
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    return this.reports.streamPaymentsCsv(from, to, res);
  }

  @Get('reports/disputes.csv')
  @ApiOperation({
    summary: 'Export dispute log as CSV for a date range (max 90 days)',
  })
  @ApiQuery({
    name: 'from',
    required: true,
    description: 'Start date (ISO 8601)',
  })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'CSV stream' })
  @ApiResponse({ status: 400, description: 'Invalid or missing date range' })
  streamDisputesCsv(
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    return this.reports.streamDisputesCsv(from, to, res);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #59 — Stellar account merge detection
  // ────────────────────────────────────────────────────────────────

  @Get('merged-accounts')
  @ApiOperation({
    summary: 'List engagements flagged as ACCOUNT_MERGED (ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Flagged engagements' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listMergedAccounts() {
    return this.mergeDetector.listMergedEngagements();
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #87 — Security audit event log
  // ────────────────────────────────────────────────────────────────

  @Get('security-events')
  @ApiOperation({
    summary: 'List security audit events (ADMIN only, append-only)',
  })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601 end date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Security events retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listSecurityEvents(@Query() dto: ListSecurityEventsDto) {
    return this.securityEvents.list(dto);
  }
}
