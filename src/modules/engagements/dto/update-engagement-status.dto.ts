import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EngagementStatus } from '@prisma/client';

export class UpdateEngagementStatusDto {
  @ApiProperty({ enum: EngagementStatus, example: EngagementStatus.CANCELLED })
  @IsEnum(EngagementStatus)
  @IsNotEmpty()
  status: EngagementStatus;

  @ApiProperty({ example: 'Legal hold initiated.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
