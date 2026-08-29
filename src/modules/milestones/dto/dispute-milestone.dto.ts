import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisputeMilestoneDto {
  @ApiProperty({ description: 'The reason why this milestone is being disputed' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000, { message: 'Reason must be 1000 characters or fewer' })
  reason: string;
}
