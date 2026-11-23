import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCostCenterDto {
  @ApiPropertyOptional({ example: 'Platform Engineering' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'ENG-002' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code must contain only letters, numbers, hyphens, or underscores',
  })
  code?: string;

  @ApiPropertyOptional({ example: '7500000000' })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/, { message: 'budget must be a positive integer string' })
  budget?: string;
}
