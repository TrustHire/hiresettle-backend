import { IsArray, IsInt, IsString, IsNotEmpty, Min, Max, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class MilestonePercentItemDto {
  @ApiProperty({ example: 0 })
  @IsInt() @Min(0)
  milestoneIndex: number;

  @ApiProperty({ example: 60 })
  @IsInt() @Min(1) @Max(100)
  paymentPercent: number;
}

export class AdjustMilestonePercentsDto {
  @ApiProperty({ type: [MilestonePercentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestonePercentItemDto)
  adjustments: MilestonePercentItemDto[];

  @ApiProperty({ example: 'Scope change agreed on 2026-08-29' })
  @IsString() @IsNotEmpty()
  reason: string;
}
