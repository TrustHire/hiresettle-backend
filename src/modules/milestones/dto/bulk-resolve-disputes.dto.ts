import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DisputeResolutionChoice } from './resolve-dispute.dto';

export class BulkResolveDisputesDto {
  @ApiProperty({ type: [String], description: 'Milestone IDs for the disputes to resolve' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  disputeIds: string[];

  @ApiProperty({ enum: DisputeResolutionChoice })
  @IsEnum(DisputeResolutionChoice)
  resolution: DisputeResolutionChoice;
}