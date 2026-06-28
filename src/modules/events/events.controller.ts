import { Controller, Get, Query, UseGuards, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, UserJwtSubThrottlerGuard)
@Roles(UserRole.ADMIN)
@Throttle({ limit: 100, ttl: 60 })
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List indexed chain events (ADMIN only)' })
  @ApiQuery({ name: 'engagementId', required: false, description: 'Filter by engagement ID' })
  @ApiQuery({ name: 'eventName', required: false, description: 'Filter by event name (e.g. milestone_confirmed)' })
  @ApiQuery({ name: 'processed', required: false, description: 'Filter by processed status (true | false)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 20)' })
  @ApiResponse({ status: 200, description: 'Events list retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  findAll(
    @Query('engagementId') engagementId?: string,
    @Query('eventName') eventName?: string,
    @Query('processed') processed?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const processedFilter =
      processed === 'true' ? true : processed === 'false' ? false : undefined;
    return this.eventsService.findAll(engagementId, eventName, processedFilter, page, limit);
  }

  @Post('process-unprocessed')
  @ApiOperation({ summary: 'Manually trigger processing of unprocessed chain events (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Processing triggered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  processUnprocessed() {
    return this.eventsService.processUnprocessedEvents();
  }
}
