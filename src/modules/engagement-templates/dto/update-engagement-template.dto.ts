import { PartialType } from '@nestjs/swagger';
import { CreateEngagementTemplateDto } from './create-engagement-template.dto';

export class UpdateEngagementTemplateDto extends PartialType(CreateEngagementTemplateDto) {}
