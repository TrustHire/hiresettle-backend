import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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
}
