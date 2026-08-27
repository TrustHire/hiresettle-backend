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
import { SearchRecruitersDto } from './dto/search-recruiters.dto';

@ApiTags('recruiters')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('recruiters')
export class RecruitersController {
  constructor(private readonly recruitersService: RecruitersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List recruiters with optional name search and pagination' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Case-insensitive partial match on recruiter name' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Results per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ID of the last recruiter from the previous page' })
  listRecruiters(@Query() query: SearchRecruitersDto) {
    return this.recruitersService.listRecruiters(query);
  }

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
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ID of the last engagement from the previous page' })
  getEngagements(
    @CurrentUser() user: User,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.recruitersService.getEngagements(user, page, limit, cursor);
  }
}
