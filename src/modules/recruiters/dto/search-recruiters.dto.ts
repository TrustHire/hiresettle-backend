import { IsOptional, IsString, IsInt, IsNumber, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const RECRUITERS_MAX_PAGE_SIZE = 100;

export class SearchRecruitersDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match against recruiter name',
    example: 'alice',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Minimum average recruiter rating (1–5)',
    example: 4,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    description: 'Filter recruiters by geographic region (case-insensitive)',
    example: 'US',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: `Results per page (max ${RECRUITERS_MAX_PAGE_SIZE})`,
    example: 20,
    default: 20,
    minimum: 1,
    maximum: RECRUITERS_MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECRUITERS_MAX_PAGE_SIZE)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'ID of the last recruiter from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
