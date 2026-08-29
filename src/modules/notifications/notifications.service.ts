import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType, Notification } from '@prisma/client';
import { MetricsService } from '../../metrics/metrics.service';
import { EmailTemplateService } from '../../common/email/email-template.service';
import { cursorPage } from '../../common/pagination/cursor-pagination';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;
  private userConnections: Map<string, any[]> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailTemplates: EmailTemplateService,
    @Optional() @InjectQueue('email') private readonly emailQueue?: Queue,
    @Optional() private readonly metrics?: MetricsService,
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

  addConnection(userId: string, res: any) {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, []);
    }
    this.userConnections.get(userId)!.push(res);
    this.metrics?.sseActiveConnections.inc();

    res.on('close', () => {
      const connections = this.userConnections.get(userId);
      if (connections) {
        const index = connections.indexOf(res);
        if (index > -1) {
          connections.splice(index, 1);
          this.metrics?.sseActiveConnections.dec();
        }
        if (connections.length === 0) {
          this.userConnections.delete(userId);
        }
      }
    });
  }

  removeConnection(userId: string, res: any) {
    const connections = this.userConnections.get(userId);
    if (connections) {
      const index = connections.indexOf(res);
      if (index > -1) {
        connections.splice(index, 1);
        this.metrics?.sseActiveConnections.dec();
      }
      if (connections.length === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  private pushToConnections(notification: Notification) {
    const connections = this.userConnections.get(notification.userId);
    if (connections) {
      connections.forEach(res => {
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
      });
    }
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

      return this.notifyUserById(user.id, type, title, message, data);
    } catch (error) {
      this.logger.error(`Failed to notify ${stellarAddress}`, error.message);
    }
  }

  async notifyUserById(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        this.logger.warn(`No user found for id ${userId} — skipping notification`);
        return;
      }

      const notification = await this.prisma.notification.create({
        data: { userId, type, title, message, data: data ?? {} },
      });

      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId_type: { userId, type } },
      });
      const sseEnabled = pref ? pref.sseEnabled : true;

      if (sseEnabled) {
        this.pushToConnections(notification);
      }

      if (user.email) {
        const emailEnabled = pref ? pref.emailEnabled : true;

        if (emailEnabled) {
          const locale = user.locale ?? 'en';
          if (this.emailQueue) {
            await this.emailQueue.add('send', {
              to: user.email,
              subject: title,
              message,
              type,
              notificationId: notification.id,
              data,
              locale,
            });
          } else {
            await this.sendEmail(user.email, title, message, type, data, locale);
            await this.prisma.notification.update({
              where: { id: notification.id },
              data: { emailSent: true },
            });
          }
        }
      }

      return notification;
    } catch (error) {
      this.logger.error(`Failed to notify user ${userId}`, error.message);
    }
  }

  async getPreferences(userId: string) {
    const saved = await this.prisma.notificationPreference.findMany({ where: { userId } });
    return Object.values(NotificationType).map((type) => {
      const pref = saved.find((p) => p.type === type);
      return {
        type,
        emailEnabled: pref ? pref.emailEnabled : true,
        inAppEnabled: pref ? pref.inAppEnabled : true,
        sseEnabled: pref ? pref.sseEnabled : true,
      };
    });
  }

  async updatePreferences(
    userId: string,
    items: { type: NotificationType; emailEnabled?: boolean; inAppEnabled?: boolean; sseEnabled?: boolean }[],
  ) {
    return Promise.all(
      items.map(({ type, ...changes }) => this.prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, ...changes },
        update: changes,
      })),
    );
  }

  async getDigestPreference(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { digestEnabled: true },
    });
    return { digestEnabled: user?.digestEnabled ?? false };
  }

  async setDigestPreference(userId: string, digestEnabled: boolean) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { digestEnabled },
    });
    return { digestEnabled };
  }

  /**
   * Send a pre-rendered weekly digest email. Renders inline HTML (no
   * notification-type template) and rethrows on failure so callers can
   * track per-user send errors.
   */
  async sendDigestEmail(to: string, subject: string, html: string) {
    await this.transporter.sendMail({
      from: this.config.get('EMAIL_FROM') ?? 'noreply@hiresettle.com',
      to,
      subject,
      html,
    });
    this.logger.log(`Digest email sent to ${to}: ${subject}`);
  }

  async findForUser(userId: string, unreadOnly = false, page = 1, limit = 20, cursor?: string) {
    const where: any = { userId };
    if (unreadOnly) where.read = false;

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(cursor
        ? { cursor: { id: cursor }, skip: 1, take: limit + 1 }
        : { skip: (page - 1) * limit, take: limit }),
    });
    const total = await this.prisma.notification.count({ where });
    const unreadCount = await this.prisma.notification.count({ where: { userId, read: false } });

    if (cursor) {
      const pageResult = cursorPage(notifications, limit);
      return { data: pageResult.data, meta: { total, limit, unreadCount, nextCursor: pageResult.nextCursor } };
    }

    return { data: notifications, meta: { total, page, limit, totalPages: Math.ceil(total / limit), unreadCount } };
  }

  async getUnreadCount(userId: string) {
    return { unreadCount: await this.prisma.notification.count({ where: { userId, read: false } }) };
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

  async remove(notificationId: string, userId: string) {
    const { count } = await this.prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    if (count === 0) throw new NotFoundException(`Notification ${notificationId} not found`);
    return { success: true };
  }

  async sendEmailDirect(
    to: string,
    subject: string,
    message: string,
    type: NotificationType,
    data?: Record<string, any>,
    locale = 'en',
  ) {
    return this.sendEmail(to, subject, message, type, data, locale);
  }

  async markEmailSent(notificationId: string) {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { emailSent: true },
    });
  }

  private async sendEmail(
    to: string,
    subject: string,
    message: string,
    type: NotificationType,
    data?: Record<string, any>,
    locale = 'en',
  ) {
    // Pick an emoji for the email subject based on notification type
    const typeEmoji: Partial<Record<NotificationType, string>> = {
      PAYMENT_RELEASED: '💰',
      MILESTONE_UNLOCKED: '🔓',
      PROOF_SUBMITTED: '📄',
      DISPUTE_RAISED: '⚠️',
      DISPUTE_RESOLVED: '⚖️',
      REPLACEMENT_REQUESTED: '🔄',
      RETENTION_WINDOW_APPROACHING: '⏰',
      PLACEMENT_MILESTONE_DUE_SOON: '📅',
      ENGAGEMENT_CANCELLED: '❌',
      ENGAGEMENT_CREATED: '🎉', // Added for completeness
      STELLAR_BALANCE_LOW: '⚠️',
    };

    const html = this.emailTemplates.render(type.toLowerCase(), locale, {
      subject: `HireSettle — ${subject}`,
      message,
      ctaLink: data?.ctaLink,
      year: new Date().getFullYear(),
      // Pass all data properties to the template context
      ...data,
    });

    try {
      await this.transporter.sendMail({
        from: this.config.get('EMAIL_FROM') ?? 'noreply@hiresettle.com',
        to,
        subject: `${typeEmoji[type] ?? '📬'} HireSettle — ${subject}`,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Email failed to ${to}`, error.message);
    }
  }
}
