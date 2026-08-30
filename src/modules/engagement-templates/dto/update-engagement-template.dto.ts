import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateEngagementTemplateDto } from './create-engagement-template.dto';

export class UpdateEngagementTemplateDto extends PartialType(CreateEngagementTemplateDto) {
  // Issue #263 — Template sharing/marketplace
  @ApiProperty({ required: false, description: 'Whether this template is listed in the public marketplace' })
  @IsOptional() @IsBoolean()
  isPublic?: boolean;
}
