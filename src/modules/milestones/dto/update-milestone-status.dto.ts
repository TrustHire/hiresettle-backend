import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MilestoneStatus } from '@prisma/client';

export class UpdateMilestoneStatusDto {
  @ApiProperty({ enum: MilestoneStatus, example: MilestoneStatus.CANCELLED })
  @IsEnum(MilestoneStatus)
  @IsNotEmpty()
  status: MilestoneStatus;

  @ApiProperty({ example: 'Technical failure, unable to verify on-chain.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
