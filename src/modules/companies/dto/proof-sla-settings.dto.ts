import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ProofSlaAction } from '@prisma/client';

export class UpdateProofSlaSettingsDto {
  @ApiPropertyOptional({ description: 'Days the company has to review submitted proof', minimum: 1, maximum: 90, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  proofSlaDays?: number;

  @ApiPropertyOptional({ enum: ProofSlaAction, description: 'What happens when the review window expires' })
  @IsOptional()
  @IsEnum(ProofSlaAction)
  proofSlaAction?: ProofSlaAction;
}
