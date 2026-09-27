import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const MAX_BILLING_CONTACTS = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async getBillingContacts(companyId: string): Promise<string[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { billingContacts: true },
    });
    return company?.billingContacts ?? [];
  }

  async setBillingContacts(companyId: string, emails: string[]): Promise<string[]> {
    if (!Array.isArray(emails)) {
      throw new BadRequestException('billingContacts must be an array of email addresses');
    }

    const normalized = emails.map((email) => (typeof email === 'string' ? email.trim() : ''));

    if (normalized.some((email) => !EMAIL_REGEX.test(email))) {
      throw new BadRequestException('One or more billing contact emails are invalid');
    }

    const unique = Array.from(new Set(normalized.map((email) => email.toLowerCase())));

    if (unique.length > MAX_BILLING_CONTACTS) {
      throw new BadRequestException(`A company can have at most ${MAX_BILLING_CONTACTS} billing contacts`);
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: { billingContacts: unique },
    });

    return unique;
  }

  private async resolveBillingRecipients(companyId: string): Promise<string[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { billingContacts: true, owner: { select: { email: true } } },
    });

    const recipients = new Set<string>();
    if (company?.owner?.email) {
      recipients.add(company.owner.email.toLowerCase());
    }
    for (const email of company?.billingContacts ?? []) {
      recipients.add(email.toLowerCase());
    }

    return Array.from(recipients);
  }

  async sendInvoice(companyId: string, invoice: { id: string; amount: number; url: string }) {
    const recipients = await this.resolveBillingRecipients(companyId);
    if (recipients.length === 0) {
      return;
    }

    await this.mail.send({
      to: recipients,
      subject: `Invoice ${invoice.id}`,
      template: 'invoice',
      context: { invoice },
    });
  }

  async sendPaymentEmail(companyId: string, payment: { id: string; amount: number; status: string }) {
    const recipients = await this.resolveBillingRecipients(companyId);
    if (recipients.length === 0) {
      return;
    }

    await this.mail.send({
      to: recipients,
      subject: `Payment ${payment.status}`,
      template: 'payment',
      context: { payment },
    });
  }
}
