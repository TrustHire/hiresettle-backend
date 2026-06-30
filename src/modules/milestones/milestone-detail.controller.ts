import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserJwtSubThrottlerGuard)
@Throttle(100, 60)
@Controller('milestones')
export class MilestoneDetailController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get milestone by ID (parties to the engagement only)' })
  @ApiParam({ name: 'id', description: 'Milestone UUID' })
  @ApiResponse({ status: 200, description: 'Milestone retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a party to this engagement' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  findById(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.findById(id, user);
  }
}
