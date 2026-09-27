import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

import { EmailTemplate, EmailTemplateName } from './email-template.enum';
import { renderEmailTemplate } from './email-template.renderer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  template: EmailTemplateName;
  locale?: string;
  context?: Record<string, unknown>;
}

export interface EmailTemplatePreview {
  name: EmailTemplateName;
  locale: string;
  subject: string;
  html: string;
}

const SAMPLE_CONTEXT: Record<string, unknown> = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  code: '123456',
  actionUrl: 'https://example.com/action',
  expiresInMinutes: 15,
  organizationName: 'Acme Inc.',
  supportEmail: 'support@example.com',
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly defaultLocale: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultLocale = this.configService.get<string>('EMAIL_DEFAULT_LOCALE', 'en');
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  listTemplates(): EmailTemplateName[] {
    return Object.values(EmailTemplateName);
  }

  previewTemplate(name: string, locale?: string): EmailTemplatePreview {
    const templateName = this.resolveTemplateName(name);
    const resolvedLocale = locale || this.defaultLocale;
    const template = EmailTemplate[templateName];

    const { subject, html } = renderEmailTemplate(templateName, resolvedLocale, SAMPLE_CONTEXT);

    return {
      name: templateName,
      locale: resolvedLocale,
      subject: subject || template.subject,
      html,
    };
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const { to, subject, template, locale, context } = options;
    const resolvedLocale = locale || this.defaultLocale;

    const { html } = renderEmailTemplate(template, resolvedLocale, context ?? {});

    await this.transporter.sendMail({
      from: this.configService.get<string>('EMAIL_FROM', 'no-reply@example.com'),
      to,
      subject,
      html,
    });

    this.logger.log(`Sent "${template}" email to ${to} (${resolvedLocale})`);
  }

  private resolveTemplateName(name: string): EmailTemplateName {
    const templateName = Object.values(EmailTemplateName).find(
      (value) => value === name,
    );

    if (!templateName) {
      throw new NotFoundException(`Email template "${name}" not found`);
    }

    return templateName;
  }
}
