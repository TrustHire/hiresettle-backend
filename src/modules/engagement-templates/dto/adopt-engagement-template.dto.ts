import { IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Issue #263 — Template sharing/marketplace
export class AdoptEngagementTemplateDto {
  @ApiProperty({ required: false, description: 'Name for the adopted template. Defaults to "<source name> (adopted)"' })
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;
}
