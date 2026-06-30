import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';

export interface WebhookPayload {
  event: 'COMPLETED' | 'CANCELLED' | 'REPLACEMENT_REQUESTED' | 'DISPUTE_RAISED' | 'PAYMENT_RELEASED';
  engagementId: string;
  status: string;
  timestamp: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Optional() @InjectQueue('webhook') private readonly webhookQueue?: Queue,
  ) {}

  async sendWebhook(url: string, payload: WebhookPayload): Promise<void> {
    if (this.webhookQueue) {
      await this.webhookQueue.add('send', { url, payload });
      this.logger.log(`Webhook job enqueued for ${url} (event: ${payload.event})`);
      return;
    }

    // Fallback: inline delivery when queue is not available
    this.logger.log(`Delivering webhook inline to ${url} (event: ${payload.event})`);
    try {
      await axios.post(url, payload, { timeout: 5000 });
    } catch (error) {
      this.logger.error(`Inline webhook delivery failed to ${url}: ${error.message}`);
    }
  }
}
