import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BackfillEventsDto {
  @ApiProperty({ description: 'First ledger to scan, inclusive', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromLedger: number;

  @ApiProperty({ description: 'Last ledger to scan, inclusive', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toLedger: number;
}