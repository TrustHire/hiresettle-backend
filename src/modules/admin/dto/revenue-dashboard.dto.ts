import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class RevenueDashboardDto {
  @ApiProperty({ description: 'ISO 8601 start date' })
  @IsDateString()
  from: string;

  @ApiProperty({ description: 'ISO 8601 end date' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({ enum: ['daily', 'monthly'], default: 'daily' })
  @IsOptional()
  @IsIn(['daily', 'monthly'])
  granularity: 'daily' | 'monthly' = 'daily';
}