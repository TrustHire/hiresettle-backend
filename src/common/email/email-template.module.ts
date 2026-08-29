import { Module } from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';

/**
 * EmailTemplateModule
 *
 * Provides EmailTemplateService, the locale-aware renderer for notification
 * email templates (src/common/email/templates/<locale>/). Imported by any
 * module that sends templated email.
 */
@Module({
  providers: [EmailTemplateService],
  exports: [EmailTemplateService],
})
export class EmailTemplateModule {}
