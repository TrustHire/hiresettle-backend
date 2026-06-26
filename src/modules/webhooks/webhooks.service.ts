import { Injectable, Logger } from '@nestjs/common';
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

  async sendWebhook(url: string, payload: WebhookPayload): Promise<void> {
    const maxRetries = 3;
    let delay = 1000;

    setTimeout(async () => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.logger.log(`Sending webhook event ${payload.event} to ${url} (Attempt ${attempt})`);
          await axios.post(url, payload, { timeout: 5000 });
          this.logger.log(`Webhook delivered successfully to ${url}`);
          return;
        } catch (error) {
          this.logger.warn(`Attempt ${attempt} failed to deliver webhook to ${url}: ${error.message}`);
          if (attempt === maxRetries) {
            this.logger.error(`Failed to deliver webhook to ${url} after ${maxRetries} attempts.`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }, 0);
  }
}
