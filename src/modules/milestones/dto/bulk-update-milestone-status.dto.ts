import {
  ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsNotEmpty, IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MilestoneStatus } from '@prisma/client';

export class BulkUpdateMilestoneStatusDto {
  @ApiProperty({ type: [String], description: 'Milestone IDs to update' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  milestoneIds: string[];

  @ApiProperty({ enum: MilestoneStatus, example: MilestoneStatus.RESOLVED })
  @IsEnum(MilestoneStatus)
  @IsNotEmpty()
  status: MilestoneStatus;

  @ApiProperty({ example: 'Batch resolution after review.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
