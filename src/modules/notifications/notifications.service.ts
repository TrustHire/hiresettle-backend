import { Injectable, Logger } from \'@nestjs/common\';\nimport { ConfigService } from \'@nestjs/config\';\nimport * as nodemailer from \'nodemailer\';\nimport * as hbs from \'nodemailer-express-handlebars\';\nimport * as path from \'path\';\nimport { PrismaService } from \'../../common/prisma/prisma.service\';\nimport { NotificationType } from \'@prisma/client\';\n\n@Injectable()\nexport class NotificationsService {\n  private readonly logger = new Logger(NotificationsService.name);\n  private transporter: nodemailer.Transporter;\n\n  constructor(\n    private readonly prisma: PrismaService,\n    private readonly config: ConfigService,\n  ) {\n    this.transporter = nodemailer.createTransport({\n      host: this.config.get(\'SMTP_HOST\'),\n      port: this.config.get<number>(\'SMTP_PORT\', 587),\n      secure: false,\n      auth: {\n        user: this.config.get(\'SMTP_USER\'),\n        pass: this.config.get(\'SMTP_PASS\'),\n      },\n    });\n\n    // Configure Handlebars for email templates\n    const templatesDir = path.resolve(__dirname, \'..\/..\/common\/email\/templates\');\n    this.transporter.use(\n      \'compile\',\n      hbs({\n        viewEngine: {\n          extname: \'.html\',\n          partialsDir: templatesDir,\n          layoutsDir: templatesDir,\n          defaultLayout: \'base\',\n        },\n        viewPath: templatesDir,\n        extName: \'.html\',\n      }),\n    );\n  }\n
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
          await this.sendEmail(user.email, title, message, type, data);
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
