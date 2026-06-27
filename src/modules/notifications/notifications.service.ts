import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType, Notification } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;
  private userConnections: Map<string, any[]> = new Map();

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

  addConnection(userId: string, res: any) {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, []);
    }
    this.userConnections.get(userId)!.push(res);
    
    res.on('close', () => {
      const connections = this.userConnections.get(userId);
      if (connections) {
        const index = connections.indexOf(res);
        if (index > -1) {
          connections.splice(index, 1);
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

      this.pushToConnections(notification);

      if (user.email) {
        const pref = await this.prisma.notificationPreference.findUnique({
          where: { userId_type: { userId, type } },
        });
        const emailEnabled = pref ? pref.emailEnabled : true;

        if (emailEnabled) {
          await this.sendEmail(user.email, title, message, type, data);
          await this.prisma.notification.update({
            where: { id: notification.id },
            data: { emailSent: true },
          });
        }
      }

      return notification;
    } catch (error) {
      this.logger.error(`Failed to notify user ${userId}`, error.message);
    }
  }

  async findForUser(userId: string, unreadOnly = false, page = 1, limit = 20) {
    const where: any = { userId };
    if (unreadOnly) where.read = false;

    const [notifications, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);

    return { data: notifications, meta: { total, page, limit, unreadCount } };
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

  private async sendEmail(
    to: string,
    subject: string,
    message: string,
    type: NotificationType,
    data?: Record<string, any>,
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
      ENGAGEMENT_CANCELLED: '❌',
      ENGAGEMENT_CREATED: '🎉', // Added for completeness
    };

    try {
      await this.transporter.sendMail({
        from: this.config.get('EMAIL_FROM', 'noreply@hiresettle.com'),
        to,
        subject: `${typeEmoji[type] ?? '📬'} HireSettle — ${subject}`,
        template: type.toLowerCase(), // Use the notification type as the template name
        context: {
          subject: `HireSettle — ${subject}`,
          message,
          ctaLink: data?.ctaLink,
          year: new Date().getFullYear(),
          // Pass all data properties to the template context
          ...data,
        },
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Email failed to ${to}`, error.message);
    }
  }
}
