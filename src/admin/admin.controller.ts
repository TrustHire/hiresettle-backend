import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

interface EmailTemplate {
  name: string;
  subject: string;
  render: (data: Record<string, any>) => string;
}

const SAMPLE_DATA: Record<string, any> = {
  name: 'Jane Doe',
  email: 'jane.doe@example.com',
  company: 'Acme Inc.',
  actionUrl: 'https://example.com/action',
  code: '123456',
  amount: '$49.00',
  date: new Date().toISOString(),
};

const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  welcome: {
    name: 'welcome',
    subject: 'Welcome to our platform',
    render: (data) =>
      `<h1>Welcome, ${data.name}!</h1><p>Thanks for signing up with ${data.company}.</p>`,
  },
  'password-reset': {
    name: 'password-reset',
    subject: 'Reset your password',
    render: (data) =>
      `<h1>Password reset</h1><p>Hi ${data.name}, use the link below to reset your password.</p><p><a href="${data.actionUrl}">Reset password</a></p>`,
  },
  'email-verification': {
    name: 'email-verification',
    subject: 'Verify your email',
    render: (data) =>
      `<h1>Verify your email</h1><p>Hi ${data.name}, your verification code is <strong>${data.code}</strong>.</p>`,
  },
  'invoice-receipt': {
    name: 'invoice-receipt',
    subject: 'Your invoice receipt',
    render: (data) =>
      `<h1>Receipt</h1><p>Hi ${data.name}, we received your payment of ${data.amount} on ${data.date}.</p>`,
  },
};

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('email-templates')
  listEmailTemplates() {
    return Object.values(EMAIL_TEMPLATES).map(({ name, subject }) => ({
      name,
      subject,
    }));
  }

  @Get('email-templates/:name/preview')
  previewEmailTemplate(
    @Param('name') name: string,
    @Query('locale') locale = 'en',
  ) {
    const template = EMAIL_TEMPLATES[name];
    if (!template) {
      throw new NotFoundException(`Email template "${name}" not found`);
    }

    const html = template.render(SAMPLE_DATA);

    return {
      name: template.name,
      subject: template.subject,
      locale,
      html,
    };
  }
}
