import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const LEADERBOARD_PERIODS = ['30d', '90d', 'all'] as const;

export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export class LeaderboardQueryDto {
  @ApiPropertyOptional({
    description: 'Time period used to rank recruiters by completed placements',
    enum: LEADERBOARD_PERIODS,
    default: 'all',
  })
  @IsOptional()
  @IsIn(LEADERBOARD_PERIODS)
  period?: LeaderboardPeriod = 'all';
}
