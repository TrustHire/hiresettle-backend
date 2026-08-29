import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetCompanyPlanDto {
  @ApiProperty({ required: false, example: 'plan_growth', description: 'Plan ID; null to remove plan' })
  @IsOptional() @IsString()
  planId?: string | null;
}
