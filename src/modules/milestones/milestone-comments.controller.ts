import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { MilestoneCommentsService } from './milestone-comments.service';
import { CreateMilestoneCommentDto } from './dto/create-milestone-comment.dto';
import { ListMilestoneCommentsDto } from './dto/list-milestone-comments.dto';

@ApiTags('milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseGuards(UserJwtSubThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('engagements/:engagementId/milestones/:index/comments')
export class MilestoneCommentsController {
  constructor(private readonly comments: MilestoneCommentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Comment on a milestone (company, recruiter or arbiter only); notifies the other participants' })
  @ApiResponse({ status: 201, description: 'Comment created' })
  @ApiResponse({ status: 403, description: 'Not a participant of this engagement' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  create(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: CreateMilestoneCommentDto,
    @CurrentUser() user: any,
  ) {
    return this.comments.create(engagementId, index, user, dto.body);
  }

  @Get()
  @ApiOperation({ summary: 'List milestone comments, oldest first, with cursor pagination' })
  @ApiResponse({ status: 200, description: '{ data, nextCursor }' })
  @ApiResponse({ status: 403, description: 'Not a participant of this engagement' })
  list(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Query() query: ListMilestoneCommentsDto,
    @CurrentUser() user: any,
  ) {
    return this.comments.list(engagementId, index, user, query);
  }
}
