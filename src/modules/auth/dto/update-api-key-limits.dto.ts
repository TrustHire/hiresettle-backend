import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Omit a field to leave it unchanged; send `null` to clear it
 * (rateLimit → global default, monthlyQuota → unlimited).
 */
export class UpdateApiKeyLimitsDto {
  @ApiPropertyOptional({
    description: 'Requests allowed per throttle window for this key; null reverts to the global THROTTLE_LIMIT',
    minimum: 1,
    nullable: true,
    example: 600,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  rateLimit?: number | null;

  @ApiPropertyOptional({
    description: 'Requests allowed per calendar month (UTC); null means unlimited',
    minimum: 1,
    nullable: true,
    example: 500000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  monthlyQuota?: number | null;
}
