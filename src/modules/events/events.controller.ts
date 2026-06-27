import { Controller, Get, Query, UseGuards, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ limit: 100, ttl: 60 })
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  @Get()
  @ApiOperation({ summary: 'List on-chain events with optional engagement filter' })
  @ApiQuery({ name: 'engagementId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('engagementId') engagementId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.eventsService.findAll(engagementId, page, limit);
  }

  @Post('process-unprocessed')
  @ApiOperation({ summary: 'Manually trigger processing of unprocessed chain events' })
  processUnprocessed() {
    return this.eventsService.processUnprocessedEvents();
  }
}
