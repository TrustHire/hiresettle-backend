import { ApiProperty } from '@nestjs/swagger';

class StatusBreakdownDto {
  @ApiProperty({ example: 5 })
  ACTIVE: number;

  @ApiProperty({ example: 12 })
  COMPLETED: number;

  @ApiProperty({ example: 2 })
  CANCELLED: number;

  @ApiProperty({ example: 1 })
  PENDING_ACCEPTANCE: number;

  @ApiProperty({ example: 0 })
  REPLACEMENT_REQUESTED: number;
}

export class CompanyEngagementStatsResponseDto {
  @ApiProperty({ example: 20, description: 'Total number of engagements for this company' })
  totalEngagements: number;

  @ApiProperty({ type: StatusBreakdownDto, description: 'Count of engagements by status' })
  byStatus: StatusBreakdownDto;

  @ApiProperty({ example: '50000000000', description: 'Total value of all engagements in stroops' })
  totalEscrowed: string;

  @ApiProperty({ example: '30000000000', description: 'Total amount released to recruiters in stroops' })
  totalReleased: string;

  @ApiProperty({ example: 45.5, description: 'Average days from creation to completion' })
  avgTimeToPlacement: number;

  @ApiProperty({ example: '2026-09-01T00:00:00Z', required: false, description: 'Filter start date if provided' })
  dateFrom?: string;

  @ApiProperty({ example: '2026-09-30T23:59:59Z', required: false, description: 'Filter end date if provided' })
  dateTo?: string;

  @ApiProperty({ example: '2026-09-28T18:30:00Z', description: 'When these stats were generated' })
  generatedAt: string;
}
