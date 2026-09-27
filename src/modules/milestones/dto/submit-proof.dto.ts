import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SubmitProofDto {
  @ApiPropertyOptional({ description: 'Link to the proof document (e.g. signed offer letter)' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'Free-text proof or notes for the reviewer', maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ description: 'Hash of the proof document, matching the on-chain submission' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  proofHash?: string;
}
