import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ApproveMilestoneDto {
  @ApiPropertyOptional({
    description: 'Proof version being approved. When given it must be the latest version, or the request fails with 409.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  proofVersion?: number;
}
