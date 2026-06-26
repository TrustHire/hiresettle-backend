import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: false,
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

  async notifyUser(
    stellarAddress: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) {
    try {
      const user = await this.prisma.user.findUnique({ where: { stellarAddress } });
      if (!user) {
        this.logger.warn(`No user found for ${stellarAddress} — skipping notification`);
        return;
      }

      const notification = await this.prisma.notification.create({
        data: { userId: user.id, type, title, message, data: data ?? {} },
      });

      if (user.email) {
        const pref = await this.prisma.notificationPreference.findUnique({
          where: { userId_type: { userId: user.id, type } },
        });
        const emailEnabled = pref ? pref.emailEnabled : true;

        if (emailEnabled) {
          await this.sendEmail(user.email, title, message, type);
          await this.prisma.notification.update({
            where: { id: notification.id },
            data: { emailSent: true },
          });
        }
      }

      return notification;
    } catch (error) {
      this.logger.error(`Failed to notify ${stellarAddress}`, error.message);
    }
  }

  async findForUser(userId: string, unreadOnly = false, page = 1, limit = 20) {
    const where: any = { userId };
    if (unreadOnly) where.read = false;

    const [notifications, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data: notifications, meta: { total, page, limit } };
  }

  async markRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  private async sendEmail(
    to: string,
    subject: string,
    text: string,
    type: NotificationType,
  ) {
    // Pick an emoji for the email subject based on notification type
    const typeEmoji: Partial<Record<NotificationType, string>> = {
      PAYMENT_RELEASED:            '💰',
      MILESTONE_UNLOCKED:          '🔓',
      PROOF_SUBMITTED:             '📄',
      DISPUTE_RAISED:              '⚠️',
      DISPUTE_RESOLVED:            '⚖️',
      REPLACEMENT_REQUESTED:       '🔄',
      RETENTION_WINDOW_APPROACHING:'⏰',
      ENGAGEMENT_CANCELLED:        '❌',
    };

    try {
      await this.transporter.sendMail({
        from: this.config.get('EMAIL_FROM', 'noreply@hiresettle.com'),
        to,
        subject: `${typeEmoji[type] ?? '📬'} HireSettle — ${subject}`,
        text,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a2e; margin-bottom: 8px;">HireSettle</h2>
            <p style="color: #444; line-height: 1.6;">${text}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <small style="color: #999;">
              You're receiving this because you're a participant on HireSettle.
            </small>
          </div>
        `,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Email failed to ${to}`, error.message);
    }
  }
}
