import {
  IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MilestonesSum100 } from '../../engagements/dto/create-engagement.dto';

export class BulkMilestoneItemDto {
  @ApiProperty({ example: 'Candidate Placed' })
  @IsString() @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 30 })
  @IsInt() @Min(1) @Max(100)
  paymentPercent: number;

  @ApiProperty({ example: 'PLACEMENT', enum: ['PLACEMENT', 'RETENTION'] })
  @IsIn(['PLACEMENT', 'RETENTION'])
  kind: 'PLACEMENT' | 'RETENTION';

  @ApiProperty({ required: false, example: 90, description: 'Retention window in days (RETENTION milestones only)' })
  @IsOptional() @IsInt() @Min(1)
  retentionDays?: number;
}

export class BulkCreateMilestonesDto {
  @ApiProperty({ type: [BulkMilestoneItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkMilestoneItemDto)
  @MilestonesSum100()
  milestones: BulkMilestoneItemDto[];
}
