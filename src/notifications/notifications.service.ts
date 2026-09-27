import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationChannel } from './enums/notification-channel.enum';
import { NotificationStatus } from './enums/notification-status.enum';

const URGENT_NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.DISPUTE,
  NotificationType.SECURITY,
];

// Only critical notification types are eligible for SMS delivery.
const SMS_ELIGIBLE_NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.DISPUTE,
  NotificationType.SECURITY,
];

const DEFAULT_DAILY_SMS_CAP = 5;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(UserNotificationPreferences)
    private readonly preferencesRepository: Repository<UserNotificationPreferences>,
  ) {}

  async send(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
    payload: Record<string, unknown>,
  ): Promise<Notification> {
    const preferences = await this.preferencesRepository.findOne({
      where: { userId },
    });

    if (channel === NotificationChannel.SMS) {
      const smsBlockReason = await this.getSmsBlockReason(userId, type, preferences);
      if (smsBlockReason) {
        this.logger.warn(
          `SMS notification ${type} for user ${userId} blocked: ${smsBlockReason}`,
        );
        return this.notificationRepository.save(
          this.notificationRepository.create({
            userId,
            type,
            channel,
            payload,
            status: NotificationStatus.FAILED,
          }),
        );
      }
    }

    const notification = this.notificationRepository.create({
      userId,
      type,
      channel,
      payload,
      status: NotificationStatus.PENDING,
    });

    if (this.shouldDelayForQuietHours(type, preferences)) {
      notification.status = NotificationStatus.QUEUED;
      notification.scheduledFor = this.getQuietHoursEnd(preferences);
      this.logger.log(
        `Notification ${type} for user ${userId} delayed until quiet hours end`,
      );
      return this.notificationRepository.save(notification);
    }

    return this.deliver(notification);
  }

  async deliverQueuedNotifications(now: Date = new Date()): Promise<Notification[]> {
    const queued = await this.notificationRepository.find({
      where: { status: NotificationStatus.QUEUED },
    });

    const delivered: Notification[] = [];
    for (const notification of queued) {
      if (notification.scheduledFor && notification.scheduledFor > now) {
        continue;
      }
      delivered.push(await this.deliver(notification));
    }

    return delivered;
  }

  private async deliver(notification: Notification): Promise<Notification> {
    notification.status = NotificationStatus.SENT;
    notification.sentAt = new Date();
    return this.notificationRepository.save(notification);
  }

  /**
   * Returns a human-readable reason when an SMS notification must not be sent,
   * or null when SMS delivery is allowed.
   */
  private async getSmsBlockReason(
    userId: string,
    type: NotificationType,
    preferences?: UserNotificationPreferences | null,
  ): Promise<string | null> {
    if (!SMS_ELIGIBLE_NOTIFICATION_TYPES.includes(type)) {
      return `notification type ${type} is not eligible for SMS`;
    }

    if (!preferences || !preferences.smsEnabled) {
      return 'SMS notifications are not enabled';
    }

    if (!preferences.phoneNumber || !preferences.phoneVerifiedAt) {
      return 'phone number is not verified';
    }

    const dailyCap = preferences.dailySmsCap ?? DEFAULT_DAILY_SMS_CAP;
    const sentToday = await this.countSmsSentToday(userId);
    if (sentToday >= dailyCap) {
      return `daily SMS cap of ${dailyCap} reached`;
    }

    return null;
  }

  private async countSmsSentToday(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.channel = :channel', {
        channel: NotificationChannel.SMS,
      })
      .andWhere('notification.status = :status', {
        status: NotificationStatus.SENT,
      })
      .andWhere('notification.sentAt >= :startOfDay', { startOfDay })
      .getCount();
  }

  private shouldDelayForQuietHours(
    type: NotificationType,
    preferences?: UserNotificationPreferences | null,
  ): boolean {
    if (!preferences || !preferences.quietHoursEnabled) {
      return false;
    }

    if (URGENT_NOTIFICATION_TYPES.includes(type)) {
      return false;
    }

    if (!preferences.quietHoursStart || !preferences.quietHoursEnd) {
      return false;
    }

    return this.isWithinQuietHours(
      new Date(),
      preferences.quietHoursStart,
      preferences.quietHoursEnd,
      preferences.timezone,
    );
  }

  private isWithinQuietHours(
    now: Date,
    start: string,
    end: string,
    timezone?: string,
  ): boolean {
    const currentMinutes = this.getMinutesInTimezone(now, timezone);
    const startMinutes = this.parseTimeToMinutes(start);
    const endMinutes = this.parseTimeToMinutes(end);

    if (startMinutes === endMinutes) {
      return false;
    }

    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    // Quiet hours span midnight (e.g. 22:00 - 07:00).
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  private getQuietHoursEnd(
    preferences?: UserNotificationPreferences | null,
  ): Date {
    const now = new Date();
    if (!preferences || !preferences.quietHoursEnd) {
      return now;
    }

    const endMinutes = this.parseTimeToMinutes(preferences.quietHoursEnd);
    const currentMinutes = this.getMinutesInTimezone(now, preferences.timezone);

    let minutesUntilEnd = endMinutes - currentMinutes;
    if (minutesUntilEnd <= 0) {
      minutesUntilEnd += 24 * 60;
    }

    return new Date(now.getTime() + minutesUntilEnd * 60 * 1000);
  }

  private getMinutesInTimezone(now: Date, timezone?: string): number {
    if (!timezone) {
      return now.getHours() * 60 + now.getMinutes();
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
      return hour * 60 + minute;
    } catch {
      return now.getHours() * 60 + now.getMinutes();
    }
  }

  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
