import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum DisputeResolutionChoice {
  RELEASE = 'RELEASE',
  REFUND = 'REFUND',
}

export class ResolveDisputeDto {
  @ApiProperty({ description: 'Arbiter resolution choice', enum: DisputeResolutionChoice })
  @IsNotEmpty()
  @IsEnum(DisputeResolutionChoice)
  resolution: DisputeResolutionChoice;
}
