import {
  Controller, Get, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery,
} from '@nestjs/swagger';
import { RecruitersService } from './recruiters.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, User } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';

@ApiTags('recruiters')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ limit: 100, ttl: 60 })
@Controller('recruiters')
export class RecruitersController {
  constructor(private readonly recruitersService: RecruitersService) {}

  @Get('me/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get recruiter performance stats' })
  getStats(@CurrentUser() user: User) {
    return this.recruitersService.getStats(user);
  }

  @Get('me/engagements')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated list of recruiter engagements' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getEngagements(
    @CurrentUser() user: User,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.recruitersService.getEngagements(user, page, limit);
  }
}
