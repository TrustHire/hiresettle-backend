import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class NotificationCleanupService {
  private readonly logger = new Logger(NotificationCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'UTC' })
  async cleanupOldNotifications() {
    this.logger.log('Starting notification cleanup job...');

    const retentionDays = this.config.get<number>('NOTIFICATION_RETENTION_DAYS', 90);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const { count } = await this.prisma.notification.deleteMany({
        where: {
          read: true,
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      this.logger.log(`Deleted ${count} old, read notifications.`);
    } catch (error) {
      this.logger.error('Failed to cleanup old notifications:', error.message);
    }
  }
}
