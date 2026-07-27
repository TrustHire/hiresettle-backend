import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetRateLimitOverrideDto {
  @ApiProperty({ description: 'Custom request limit per throttle window for this user', minimum: 1 })
  @IsInt()
  @Min(1)
  limit: number;
}
