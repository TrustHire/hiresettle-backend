import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

const DEFAULT_FAILURE_THRESHOLD = 50;

/**
 * Current webhook payload format version. Bump this when the payload shape
 * changes so consumers can opt into the new format via their subscription.
 */
export const CURRENT_WEBHOOK_VERSION = 1;

/**
 * Oldest payload version still supported. Subscriptions pinned to a version
 * below this are upgraded to CURRENT_WEBHOOK_VERSION. Older versions remain
 * deliverable during the deprecation window instead of breaking consumers.
 */
export const MIN_SUPPORTED_WEBHOOK_VERSION = 1;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get failureThreshold(): number {
    const configured = Number(process.env.WEBHOOK_FAILURE_THRESHOLD);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_FAILURE_THRESHOLD;
  }

  /**
   * Resolve the payload version a subscription is pinned to. Subscriptions
   * without an explicit version default to the current format, and versions
   * below the supported floor are clamped up so deliveries never break.
   */
  getSubscriptionVersion(subscription: WebhookSubscription): number {
    const version = subscription.version ?? CURRENT_WEBHOOK_VERSION;
    return version < MIN_SUPPORTED_WEBHOOK_VERSION
      ? MIN_SUPPORTED_WEBHOOK_VERSION
      : version;
  }

  /**
   * Build the headers sent with every webhook delivery, including the
   * X-Webhook-Version header reflecting the subscription's payload version.
   */
  buildDeliveryHeaders(subscription: WebhookSubscription): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Webhook-Version': String(this.getSubscriptionVersion(subscription)),
    };
  }

  async recordDeliverySuccess(subscriptionId: string): Promise<void> {
    await this.subscriptionRepository.update(subscriptionId, {
      consecutiveFailures: 0,
    });
  }

  async recordDeliveryFailure(
    subscriptionId: string,
    error?: string,
  ): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      throw new NotFoundException('Webhook subscription not found');
    }

    const consecutiveFailures = (subscription.consecutiveFailures ?? 0) + 1;
    const shouldDisable =
      subscription.active && consecutiveFailures >= this.failureThreshold;

    await this.subscriptionRepository.update(subscriptionId, {
      consecutiveFailures,
      active: shouldDisable ? false : subscription.active,
      disabledAt: shouldDisable ? new Date() : subscription.disabledAt,
    });

    if (shouldDisable) {
      await this.notifyOwnerOfAutoDisable(subscription, consecutiveFailures, error);
    }
  }

  async reenableSubscription(subscriptionId: string): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      throw new NotFoundException('Webhook subscription not found');
    }

    await this.subscriptionRepository.update(subscriptionId, {
      active: true,
      consecutiveFailures: 0,
      disabledAt: null,
    });

    return this.subscriptionRepository.findOne({ where: { id: subscriptionId } });
  }

  private async notifyOwnerOfAutoDisable(
    subscription: WebhookSubscription,
    consecutiveFailures: number,
    error?: string,
  ): Promise<void> {
    const owner = subscription.owner;
    if (!owner) {
      this.logger.warn(
        `Webhook subscription ${subscription.id} auto-disabled but has no owner to notify`,
      );
      return;
    }

    const message =
      `Your webhook subscription "${subscription.name ?? subscription.id}" was ` +
      `automatically disabled after ${consecutiveFailures} consecutive failed deliveries.` +
      (error ? ` Last error: ${error}` : '');

    try {
      await this.mailService.send({
        to: owner.email,
        subject: 'Webhook subscription disabled after repeated failures',
        text: message,
      });
    } catch (mailError) {
      this.logger.error(
        `Failed to email owner of webhook subscription ${subscription.id}`,
        mailError as Error,
      );
    }

    try {
      await this.notificationsService.create({
        userId: owner.id,
        type: 'webhook.disabled',
        message,
      });
    } catch (notificationError) {
      this.logger.error(
        `Failed to create in-app notification for webhook subscription ${subscription.id}`,
        notificationError as Error,
      );
    }
  }
}
