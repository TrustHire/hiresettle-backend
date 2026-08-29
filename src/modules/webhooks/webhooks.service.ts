import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import * as crypto from 'crypto';
import { signWebhookBody, WEBHOOK_SIGNATURE_HEADER } from './webhook-signing.util';

export interface WebhookPayload {
  event: 'COMPLETED' | 'CANCELLED' | 'REPLACEMENT_REQUESTED' | 'DISPUTE_RAISED' | 'PAYMENT_RELEASED';
  engagementId: string;
  status: string;
  timestamp: string;
}

export interface WebhookDeliveryMeta {
  userId?: string;
  secret?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Optional() @InjectQueue('webhook') private readonly webhookQueue?: Queue,
  ) {}

  async sendWebhook(url: string, payload: WebhookPayload, meta: WebhookDeliveryMeta = {}): Promise<void> {
    if (!url) return;

    if (this.webhookQueue) {
      await this.webhookQueue.add('send', { url, payload, userId: meta.userId, secret: meta.secret });
      this.logger.log(`Webhook job enqueued for ${url} (event: ${payload.event})`);
      return;
    }

    // Fallback: inline delivery when queue is not available
    this.logger.log(`Delivering webhook inline to ${url} (event: ${payload.event})`);
    try {
      const rawBody = JSON.stringify(payload);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (meta.secret) {
        headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookBody(rawBody, meta.secret);
      }
      await axios.post(url, rawBody, { timeout: 5000, headers });
    } catch (error) {
      this.logger.error(`Inline webhook delivery failed to ${url}: ${error.message}`);
    }
  }

  listSupportedEvents() {
    return [
      {
        name: 'COMPLETED',
        description: 'A milestone was confirmed and payment was released.',
        examplePayload: { event: 'COMPLETED', engagementId: 'eng_123', status: 'COMPLETED', timestamp: '2026-08-29T00:00:00.000Z' },
      },
      {
        name: 'CANCELLED',
        description: 'An engagement was cancelled and no further payments will be made.',
        examplePayload: { event: 'CANCELLED', engagementId: 'eng_123', status: 'CANCELLED', timestamp: '2026-08-29T00:00:00.000Z' },
      },
      {
        name: 'REPLACEMENT_REQUESTED',
        description: 'A replacement candidate was requested for an engagement.',
        examplePayload: { event: 'REPLACEMENT_REQUESTED', engagementId: 'eng_123', status: 'REPLACEMENT_REQUESTED', timestamp: '2026-08-29T00:00:00.000Z' },
      },
      {
        name: 'DISPUTE_RAISED',
        description: 'A milestone was disputed after proof submission.',
        examplePayload: { event: 'DISPUTE_RAISED', engagementId: 'eng_123', status: 'DISPUTED', timestamp: '2026-08-29T00:00:00.000Z' },
      },
      {
        name: 'PAYMENT_RELEASED',
        description: 'A payment release notification was emitted after a milestone confirmed.',
        examplePayload: { event: 'PAYMENT_RELEASED', engagementId: 'eng_123', status: 'ACTIVE', timestamp: '2026-08-29T00:00:00.000Z' },
      },
    ];
  }

  verifyProviderSignature(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string): boolean {
    if (!rawBody || !signatureHeader || !secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(Buffer.isBuffer(rawBody) ? rawBody : rawBody).digest('hex');
    if (expected.length !== signatureHeader.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  }

  getProviderSignatureHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
    const keys = ['x-billing-signature', 'x-provider-signature', 'x-signature', 'x-hiresettle-signature', 'x-hire-settle-signature', 'x-webhook-signature'];
    for (const key of keys) {
      const value = headers[key];
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && value.length) return value[0];
    }
    return undefined;
  }
}
