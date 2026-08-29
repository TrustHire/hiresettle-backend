import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class SetPlacementDueDateDto {
  @ApiProperty({
    example: '2026-10-01',
    description:
      'ISO 8601 date string for the expected proof-submission date of a PLACEMENT milestone. ' +
      'Send null to clear it. Used by the placement reminder scheduler (#260).',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  placementDueAt: string | null;
}
