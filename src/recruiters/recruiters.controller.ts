import { Controller, Get, Post, Put, Body, Param, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { RecruitersService } from './recruiters.service';

const MAX_SPECIALIZATIONS = 5;
const MIN_RESPONSE_TIME_DATA_POINTS = 3;
const LEADERBOARD_PERIODS = ['30d', '90d', 'all'];

@Controller('recruiters')
export class RecruitersController {
  constructor(private readonly recruitersService: RecruitersService) {}

  @Get()
  async findAll(@Query('specialization') specialization?: string) {
    return this.recruitersService.findAll({ specialization });
  }

  @Get('leaderboard')
  async getLeaderboard(@Query('period') period?: string) {
    const normalizedPeriod = period ?? 'all';
    if (!LEADERBOARD_PERIODS.includes(normalizedPeriod)) {
      throw new BadRequestException(
        `period must be one of: ${LEADERBOARD_PERIODS.join(', ')}`,
      );
    }
    return this.recruitersService.getLeaderboard(normalizedPeriod);
  }

  @Get('specializations')
  async listSpecializations() {
    return this.recruitersService.listSpecializations();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const recruiter = await this.recruitersService.findOne(id);
    if (!recruiter) {
      throw new NotFoundException(`Recruiter ${id} not found`);
    }
    return recruiter;
  }

  @Get(':id/stats')
  async getStats(@Param('id') id: string) {
    const recruiter = await this.recruitersService.findOne(id);
    if (!recruiter) {
      throw new NotFoundException(`Recruiter ${id} not found`);
    }
    const responseTime = await this.recruitersService.getResponseTimeMetric(id);
    return {
      ...recruiter,
      responseTime: {
        inviteToDecision:
          responseTime.inviteToDecisionCount >= MIN_RESPONSE_TIME_DATA_POINTS
            ? responseTime.inviteToDecisionMedianMs
            : null,
        disputeToFirstResponse:
          responseTime.disputeToFirstResponseCount >= MIN_RESPONSE_TIME_DATA_POINTS
            ? responseTime.disputeToFirstResponseMedianMs
            : null,
      },
    };
  }

  @Put(':id/specializations')
  async setSpecializations(
    @Param('id') id: string,
    @Body() body: { specializationIds?: string[] },
  ) {
    const specializationIds = body?.specializationIds ?? [];
    if (!Array.isArray(specializationIds)) {
      throw new BadRequestException('specializationIds must be an array');
    }
    if (specializationIds.length > MAX_SPECIALIZATIONS) {
      throw new BadRequestException(
        `A recruiter can have at most ${MAX_SPECIALIZATIONS} specializations`,
      );
    }
    const recruiter = await this.recruitersService.setSpecializations(
      id,
      specializationIds,
    );
    if (!recruiter) {
      throw new NotFoundException(`Recruiter ${id} not found`);
    }
    return recruiter;
  }
}
