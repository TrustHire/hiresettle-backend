import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PartialRemainderAction } from '@prisma/client';

export class ProposePartialReleaseDto {
  @ApiPropertyOptional({ description: 'Amount to release, in stroops (integer string). Use this or releasePercent.' })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'releaseAmount must be a positive integer string (stroops)' })
  releaseAmount?: string;

  @ApiPropertyOptional({ description: 'Percentage of the escrow still held on the milestone to release (1-99)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  releasePercent?: number;

  @ApiProperty({ enum: PartialRemainderAction, description: 'REFUND the remainder to the company, or RETAIN it in escrow' })
  @IsEnum(PartialRemainderAction)
  remainderAction: PartialRemainderAction;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
