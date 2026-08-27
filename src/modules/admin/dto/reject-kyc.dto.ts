import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectKycDto {
  @ApiPropertyOptional({ example: 'Document image is unclear; please resubmit.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
