import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/**
 * WebPushService
 *
 * Browser push notifications using VAPID (#392). Subscriptions are stored per
 * device; ones the push service reports as expired (404/410) are deleted.
 * Push is disabled (no-op) until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set.
 */
@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) {
      this.logger.warn('VAPID keys not configured — web push notifications are disabled');
      return;
    }
    const subject = this.config.get<string>('VAPID_SUBJECT', 'mailto:noreply@hiresettle.com');
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getPublicKey(): { publicKey: string } {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    if (!this.configured || !publicKey) {
      throw new ServiceUnavailableException('Web push is not configured');
    }
    return { publicKey };
  }

  /**
   * Register (or re-assign) a browser push subscription for a user. The
   * endpoint is unique per browser, so re-subscribing updates the keys.
   */
  async subscribe(userId: string, input: PushSubscriptionInput) {
    const subscription = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent,
      },
    });
    return { id: subscription.id, endpoint: subscription.endpoint, createdAt: subscription.createdAt };
  }

  async unsubscribe(userId: string, endpoint: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { success: count > 0 };
  }

  async listForUser(userId: string) {
    return this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, userAgent: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Push a notification to every registered browser for its user. Never
   * throws: delivery failures are logged, expired subscriptions removed.
   */
  async sendNotification(notification: Notification): Promise<void> {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: notification.userId },
    });
    if (subscriptions.length === 0) return;

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://app.hiresettle.com');
    const payload = JSON.stringify({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.message,
      url: frontendUrl,
      createdAt: notification.createdAt,
    });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 },
          );
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastUsedAt: new Date() },
          });
        } catch (error) {
          const statusCode: number | undefined = error?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
            this.logger.log(`Removed expired push subscription ${sub.id} (status ${statusCode})`);
            return;
          }
          this.logger.error(
            `Web push to subscription ${sub.id} failed${statusCode ? ` (status ${statusCode})` : ''}: ${error?.message}`,
          );
        }
      }),
    );
  }
}
