import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes } from 'crypto';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';

const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async findAll(): Promise<WebhookSubscription[]> {
    return this.subscriptionRepository.find();
  }

  async findOne(id: string): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionRepository.findOne({ where: { id } });
    if (!subscription) {
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    }
    return subscription;
  }

  async create(data: Partial<WebhookSubscription>): Promise<WebhookSubscription> {
    const subscription = this.subscriptionRepository.create({
      ...data,
      secret: data.secret ?? this.generateSecret(),
    });
    return this.subscriptionRepository.save(subscription);
  }

  async update(id: string, data: Partial<WebhookSubscription>): Promise<WebhookSubscription> {
    const subscription = await this.findOne(id);
    Object.assign(subscription, data);
    return this.subscriptionRepository.save(subscription);
  }

  async remove(id: string): Promise<void> {
    const subscription = await this.findOne(id);
    await this.subscriptionRepository.remove(subscription);
  }

  /**
   * Rotate the signing secret for a subscription. The previous secret is kept
   * for a grace period (default 24h) so consumers can update at their own pace.
   * Deliveries are signed with both secrets while the grace period is active.
   */
  async rotateSecret(
    id: string,
    gracePeriodMs: number = DEFAULT_GRACE_PERIOD_MS,
  ): Promise<WebhookSubscription> {
    const subscription = await this.findOne(id);
    subscription.previousSecret = subscription.secret;
    subscription.secret = this.generateSecret();
    subscription.secretRotatedAt = new Date();
    subscription.previousSecretExpiresAt = new Date(Date.now() + gracePeriodMs);
    return this.subscriptionRepository.save(subscription);
  }

  /**
   * Returns the secrets that should be used to sign a delivery right now.
   * The old secret is included only while its grace period has not expired.
   */
  getActiveSecrets(subscription: WebhookSubscription): string[] {
    const secrets = [subscription.secret];
    if (
      subscription.previousSecret &&
      subscription.previousSecretExpiresAt &&
      subscription.previousSecretExpiresAt.getTime() > Date.now()
    ) {
      secrets.push(subscription.previousSecret);
    }
    return secrets;
  }

  /**
   * Removes the previous secret once the grace period has elapsed. Intended to
   * be called by a scheduled cleanup job.
   */
  async pruneExpiredSecrets(): Promise<void> {
    const subscriptions = await this.subscriptionRepository.find();
    const now = Date.now();
    const expired = subscriptions.filter(
      (subscription) =>
        subscription.previousSecret &&
        subscription.previousSecretExpiresAt &&
        subscription.previousSecretExpiresAt.getTime() <= now,
    );
    for (const subscription of expired) {
      subscription.previousSecret = null;
      subscription.previousSecretExpiresAt = null;
    }
    if (expired.length > 0) {
      await this.subscriptionRepository.save(expired);
    }
  }

  async deliver(subscription: WebhookSubscription, payload: unknown): Promise<WebhookDelivery> {
    const body = JSON.stringify(payload);
    const signatures = this.getActiveSecrets(subscription).map((secret) =>
      this.sign(body, secret),
    );

    const delivery = this.deliveryRepository.create({
      subscriptionId: subscription.id,
      payload: body,
      signature: signatures[0],
      signatures,
      status: 'pending',
    });
    return this.deliveryRepository.save(delivery);
  }

  private sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  private generateSecret(): string {
    return randomBytes(32).toString('hex');
  }
}
