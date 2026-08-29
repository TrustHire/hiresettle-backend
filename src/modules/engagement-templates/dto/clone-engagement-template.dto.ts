import { IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloneEngagementTemplateDto {
  @ApiProperty({ required: false, description: 'Name for the cloned template. Defaults to "<source name> (copy)"' })
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;
}
