import { Module } from '@nestjs/common';
import { EngagementTemplatesController } from './engagement-templates.controller';
import { EngagementTemplatesService } from './engagement-templates.service';

@Module({
  controllers: [EngagementTemplatesController],
  providers: [EngagementTemplatesService],
  exports: [EngagementTemplatesService],
})
export class EngagementTemplatesModule {}
