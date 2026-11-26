import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class EngagementProposalMilestoneDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage: number;
}

export class CreateEngagementProposalDto {
  @IsNumber()
  @Min(0)
  proposedFee: number;

  @IsOptional()
  @IsString()
  message?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EngagementProposalMilestoneDto)
  milestones: EngagementProposalMilestoneDto[];
}
