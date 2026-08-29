import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSecurityEventsDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 start date' }) @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date' }) @IsOptional() @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;
}
