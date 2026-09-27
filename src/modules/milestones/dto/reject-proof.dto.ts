import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RejectProofDto {
  @ApiProperty({ description: 'Why the proof was rejected — shown to the recruiter', maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({ description: 'Proof version being rejected; must be the latest' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNumber?: number;
}
