import { IsOptional, IsString, IsInt, MaxLength, Min, Max } from 'class-validator';
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
}
