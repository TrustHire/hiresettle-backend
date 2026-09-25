import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiKeyScope } from '../../../common/decorators/api-key-scopes.decorator';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'User who owns the key (usually a COMPANY account)' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 'ATS integration' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: 'Optional company scope; defaults to userId for COMPANY users' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ description: 'ISO expiry; omit for non-expiring keys' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Scopes granted to the key. Omit or pass an empty array for an unrestricted key (backward-compatible). ' +
      'Valid values: engagements:read, engagements:write, milestones:read, milestones:write, ' +
      'webhooks:manage, notifications:read',
    enum: ApiKeyScope,
    isArray: true,
    example: [ApiKeyScope.ENGAGEMENTS_READ, ApiKeyScope.MILESTONES_READ],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ApiKeyScope, { each: true })
  scopes?: ApiKeyScope[];
}
