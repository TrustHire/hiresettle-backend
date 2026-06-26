import { IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Optional name of the user profile' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Optional company name association' })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional({ description: 'Optional HTTP outgoing webhook delivery target destination URL' })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid webhook URL format' })
  webhookUrl?: string;
}
