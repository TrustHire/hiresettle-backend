import { Controller, Get, Param, ParseIntPipe, UseGuards, Patch, UnprocessableEntityException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';

@ApiTags('milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseGuards(UserJwtSubThrottlerGuard)
@Throttle({ limit: 100, ttl: 60 })
@Controller('engagements/:engagementId/milestones')
export class MilestonesController {

  constructor(private readonly milestonesService: MilestonesService) { }

  @Get()
  @ApiOperation({ summary: 'List all milestones for an engagement' })
  findAll(@Param('engagementId') engagementId: string) {
    return this.milestonesService.findByEngagement(engagementId);
  }

  @Get(':index')
  @ApiOperation({ summary: 'Get a single milestone by index' })
  findOne(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.milestonesService.findOne(engagementId, index);
  }

  @Get(':index/timer')
  @ApiOperation({ summary: 'Get retention countdown timer for a Locked milestone' })
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
  resolveDispute(
    @Param('engagementId') engagementId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ResolveDisputeDto,
  ) {
    if (req.user.role !== UserRole.ARBITER) {
      throw new ForbiddenException('Only assigned arbiters can resolve structural disputes.');
    }
    return this.milestonesService.resolveDisputeFlow(engagementId, index, dto.resolution);
  }
}
