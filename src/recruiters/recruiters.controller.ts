import { Controller, Get, Post, Put, Body, Param, Query, NotFoundException, BadRequestException, Res } from '@nestjs/common';
import { Response } from 'express';
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

  @Get('me/payouts')
  async getMyPayouts(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const parsedPage = page !== undefined ? Number(page) : 1;
    const parsedLimit = limit !== undefined ? Number(limit) : 20;
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100');
    }
    const fromDate = from !== undefined ? new Date(from) : undefined;
    const toDate = to !== undefined ? new Date(to) : undefined;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('from must be a valid date');
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('to must be a valid date');
    }
    const result = await this.recruitersService.getMyPayouts({
      from: fromDate,
      to: toDate,
      page: parsedPage,
      limit: parsedLimit,
    });
    if (format === 'csv') {
      const header = 'amount,token,engagement,milestone,txHash,date';
      const rows = result.items.map((p) =>
        [p.amount, p.token, p.engagement, p.milestone, p.txHash, p.date]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(','),
      );
      const csv = [header, ...rows].join('\n');
      if (res) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="payouts.csv"',
        );
      }
      return csv;
    }
    return result;
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
