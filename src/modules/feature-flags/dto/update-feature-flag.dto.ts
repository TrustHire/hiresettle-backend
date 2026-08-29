import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFeatureFlagDto {
  @ApiProperty({ description: 'Whether the feature flag is enabled' })
  @IsBoolean()
  @IsNotEmpty()
  isEnabled: boolean;

  @ApiPropertyOptional({ description: 'Optional description of the feature flag' })
  @IsString()
  @IsOptional()
  description?: string;
}
