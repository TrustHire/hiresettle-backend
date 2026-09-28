import { IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompanyStatsQueryDto {
  @ApiProperty({ 
    example: '2026-09-01',
    description: 'Filter engagements created from this date (ISO 8601)',
    required: false
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ 
    example: '2026-09-30',
    description: 'Filter engagements created up to this date (ISO 8601)',
    required: false
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
