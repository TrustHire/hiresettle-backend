import {
  Controller,
  Get,
  Delete,
  Post,
  Put,
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
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminUsersService } from './admin-users.service';
import { AdminDeadLetterService } from './admin-dead-letter.service';
import { AdminReportsService } from './admin-reports.service';
import { StellarMergeDetectorService } from './stellar-merge-detector.service';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminWebhooksService } from './admin-webhooks.service';
import { ListUsersDto } from './dto/list-users.dto';
import { AssignArbiterDto } from './dto/assign-arbiter.dto';
import { AuditLogsQueryDto } from './dto/audit-logs.dto';
import { SetRateLimitOverrideDto } from './dto/set-rate-limit-override.dto';
import { SetCompanyVerificationDto } from './dto/set-company-verification.dto';
import { CacheService } from '../../common/cache/cache.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';
import { ListSecurityEventsDto } from '../../common/security-events/dto/list-security-events.dto';
import { GdprService } from '../users/gdpr.service';
import { AuthService, RequestMeta } from '../auth/auth.service';
import { ApiKeysService } from '../auth/api-keys.service';
import { CreateApiKeyDto } from '../auth/dto/create-api-key.dto';

import { SetCompanyPlanDto } from './dto/set-company-plan.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
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
    private readonly auditLogs: AdminAuditLogsService,
    private readonly gdpr: GdprService,
    private readonly adminWebhooks: AdminWebhooksService,
    private readonly authService: AuthService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  @Get('maintenance-mode')
  @ApiOperation({ summary: 'Get API maintenance mode status (admin only)' })
  getMaintenanceMode() {
    return this.maintenanceMode.isEnabled().then((enabled) => ({ enabled }));
  }

  @Put('maintenance-mode')
  @AllowDuringMaintenance()
  @ApiOperation({ summary: 'Enable or disable API maintenance mode (admin only)' })
  @ApiResponse({ status: 200, description: 'Maintenance mode updated' })
  @ApiResponse({ status: 503, description: 'API is in maintenance mode' })
  setMaintenanceMode(@Body() dto: SetMaintenanceModeDto) {
    return this.maintenanceMode.setEnabled(dto.enabled);
  }

  @Get('users')
  @ApiOperation({ summary: 'List / search users (admin only)' })
  @ApiResponse({ status: 200, description: 'Users list retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminUsers.listUsers(dto);
  }

  @Post('users/:id/impersonate')
  @ApiOperation({ summary: 'Issue a short-lived token to view the app as a user' })
  @ApiParam({ name: 'id', description: 'Target user ID' })
  @ApiResponse({ status: 200, description: 'Impersonation token issued' })
  @ApiResponse({ status: 403, description: 'User is not available for impersonation' })
  issueImpersonationToken(@Param('id') id: string, @Req() req: Request) {
    const adminId = (req.user as any)?.id;
    const meta: RequestMeta = {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.authService.issueImpersonationToken(adminId, id, meta);
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

  @Get('dashboard/revenue')
  @ApiOperation({ summary: 'Get platform revenue trends (admin only)' })
  @ApiQuery({ name: 'from', required: true, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO 8601 end date' })
  @ApiQuery({ name: 'granularity', required: false, enum: ['daily', 'monthly'], description: 'Revenue bucket size' })
  @ApiResponse({ status: 200, description: 'Platform revenue trends retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid date range or granularity' })
  getRevenueDashboard(@Query() dto: RevenueDashboardDto) {
    return this.reports.getRevenueDashboard(dto.from, dto.to, dto.granularity);
  }

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

  @Get('audit-logs')
  @ApiOperation({
    summary: 'List unified audit logs (ADMIN only)',
  })
  @ApiQuery({ name: 'actorId', required: false, description: 'Filter by actor (user) ID' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action type' })
  @ApiQuery({ name: 'entityType', required: false, description: 'Filter by entity type' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601 end date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listAuditLogs(@Query() dto: AuditLogsQueryDto) {
    return this.auditLogs.queryAuditLogs(dto);
  }

  @Get('audit-log/export')
  @ApiOperation({ summary: 'Export the full audit trail as CSV (ADMIN only)' })
  @ApiQuery({ name: 'from', required: true, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO 8601 end date' })
  @ApiResponse({ status: 200, description: 'Audit trail CSV stream' })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  streamAuditLogExport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    return this.auditLogs.streamAuditLogCsv(from, to, res);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #97 — GDPR data deletion queue
  // ────────────────────────────────────────────────────────────────

  @Get('data-deletion-requests')
  @ApiOperation({ summary: 'List GDPR data deletion requests (ADMIN only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Deletion requests retrieved' })
  listDeletionRequests(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.gdpr.listRequests(Number(page) || 1, Number(limit) || 20);
  }

  @Post('data-deletion-requests/:id/process')
  @ApiOperation({ summary: 'Mark a GDPR deletion request as processed (ADMIN only)' })
  @ApiParam({ name: 'id', description: 'DataDeletionRequest ID' })
  @ApiResponse({ status: 201, description: 'Request marked as processed' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  processDeletionRequest(@Param('id') id: string, @Req() req: Request) {
    return this.gdpr.processRequest(id, (req.user as any)?.id);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #176 — Manual resend of a failed webhook delivery
  // ────────────────────────────────────────────────────────────────

  @Post('webhooks/deliveries/:id/resend')
  @ApiOperation({ summary: 'Manually resend a failed webhook delivery (ADMIN only)' })
  @ApiParam({ name: 'id', description: 'WebhookDelivery ID' })
  @ApiResponse({ status: 201, description: 'Resend triggered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Webhook delivery not found' })
  resendWebhookDelivery(@Param('id') id: string, @Req() req: Request) {
    return this.adminWebhooks.resendDelivery(id, (req.user as any)?.id);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #177 — Per-user rate-limit override
  // ────────────────────────────────────────────────────────────────

  @Put('users/:id/rate-limit-override')
  @ApiOperation({ summary: 'Set a custom rate-limit override for a user (ADMIN only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Rate-limit override set' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  setRateLimitOverride(@Param('id') id: string, @Body() dto: SetRateLimitOverrideDto) {
    return this.adminUsers.setRateLimitOverride(id, dto.limit);
  }

  @Delete('users/:id/rate-limit-override')
  @ApiOperation({ summary: "Clear a user's rate-limit override, reverting to the default limit (ADMIN only)" })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Rate-limit override cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  clearRateLimitOverride(@Param('id') id: string) {
    return this.adminUsers.clearRateLimitOverride(id);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #238 — API keys for server-to-server integrations
  // ────────────────────────────────────────────────────────────────

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an API key for a user (ADMIN only). Raw key is returned once and never again.',
  })
  @ApiResponse({ status: 201, description: 'API key created; raw key included in response once' })
  @ApiResponse({ status: 404, description: 'User not found' })
  createApiKey(@Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(dto);
  }

  @Get('api-keys')
  @ApiOperation({ summary: 'List API keys (optionally filtered by userId). Hashes are never returned.' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by owning user ID' })
  @ApiResponse({ status: 200, description: 'API key metadata list' })
  listApiKeys(@Query('userId') userId?: string) {
    return this.apiKeys.list(userId);
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an API key (ADMIN only)' })
  @ApiParam({ name: 'id', description: 'API key ID' })
  @ApiResponse({ status: 200, description: 'API key revoked' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  revokeApiKey(@Param('id') id: string) {
    return this.apiKeys.revoke(id);
  }

  // ────────────────────────────────────────────────────────────────
  // Issue #267 — Tiered subscription billing plans
  // ────────────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'List all available subscription plans (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Plans list' })
  listPlans() {
    return this.adminUsers.listPlans();
  }

  @Put('users/:id/plan')
  @ApiOperation({ summary: "Set or clear a company's subscription plan (ADMIN only)" })
  @ApiParam({ name: 'id', description: 'Company user ID' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  @ApiResponse({ status: 400, description: 'User is not a company' })
  @ApiResponse({ status: 404, description: 'User or plan not found' })
  setCompanyPlan(@Param('id') id: string, @Body() dto: SetCompanyPlanDto) {
    return this.adminUsers.setCompanyPlan(id, dto.planId ?? null);
  }
}
