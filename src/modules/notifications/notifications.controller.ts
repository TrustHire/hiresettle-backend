import { Controller, Get, Patch, Delete, Param, Query, UseGuards, Res, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam, ApiResponse } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { Response } from 'express';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateDigestPreferenceDto } from './dto/update-digest-preference.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) { }

  @Get()
  @ApiOperation({ summary: 'Get notifications for the authenticated user' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean, description: 'Show only unread notifications' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ID of the last notification from the previous page' })
  @ApiResponse({ status: 200, description: 'Notifications list retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @CurrentUser('id') userId: string,
    @Query('unreadOnly') unreadOnly?: boolean,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.notificationsService.findForUser(userId, unreadOnly, page, limit, cursor);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification channel preferences for the current user (creates defaults if none exist)' })
  @ApiResponse({ status: 200, description: 'Preferences returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getPreferences(@CurrentUser('id') userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification channel preferences for the current user (upserts missing rows, supports partial updates)' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto.preferences);
  }

  @Get('digest-preference')
  @ApiOperation({ summary: 'Get the weekly digest email opt-in status for the current user' })
  @ApiResponse({ status: 200, description: 'Digest preference returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getDigestPreference(@CurrentUser('id') userId: string) {
    return this.notificationsService.getDigestPreference(userId);
  }

  @Patch('digest-preference')
  @ApiOperation({ summary: 'Opt in or out of the weekly digest email for the current user' })
  @ApiResponse({ status: 200, description: 'Digest preference updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updateDigestPreference(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateDigestPreferenceDto,
  ) {
    return this.notificationsService.setDigestPreference(userId, dto.digestEnabled);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notifications count' })
  getUnreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Get('stream')
  @ApiOperation({ summary: 'Real-time notification stream via SSE' })
  streamNotifications(
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Send initial comment to establish connection
    res.write(': keep-alive\n\n');

    // Add connection to the service
    this.notificationsService.addConnection(userId, res);

    // Handle client disconnect
    res.on('close', () => {
      this.notificationsService.removeConnection(userId, res);
    });
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markRead(id, userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiResponse({ status: 200, description: 'Notification deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.remove(id, userId);
  }
}
