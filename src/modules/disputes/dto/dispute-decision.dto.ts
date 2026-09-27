import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DisputeOutcome } from '@prisma/client';

export class DisputeDecisionDto {
  @ApiProperty({ description: 'RELEASE pays the recruiter, REFUND returns funds to the company', enum: DisputeOutcome })
  @IsEnum(DisputeOutcome)
  outcome: DisputeOutcome;
}
