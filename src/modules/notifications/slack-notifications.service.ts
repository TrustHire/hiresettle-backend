import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NotificationType } from '@prisma/client';

/**
 * Notification types that are posted to a company's Slack channel when the
 * user has a webhook configured. These are the actionable, company-facing
 * events a team would want alerted on.
 */
export const SLACK_KEY_TYPES: NotificationType[] = [
  NotificationType.ENGAGEMENT_CREATED,
  NotificationType.PROOF_SUBMITTED,
  NotificationType.MILESTONE_CONFIRMED,
  NotificationType.PAYMENT_RELEASED,
  NotificationType.DISPUTE_RAISED,
  NotificationType.DISPUTE_RESOLVED,
  NotificationType.REPLACEMENT_REQUESTED,
  NotificationType.ENGAGEMENT_CANCELLED,
  NotificationType.FUNDING_SHORTFALL_DETECTED,
];

const TYPE_EMOJI: Partial<Record<NotificationType, string>> = {
  ENGAGEMENT_CREATED: '🎉',
  PROOF_SUBMITTED: '📄',
  MILESTONE_CONFIRMED: '✅',
  PAYMENT_RELEASED: '💰',
  DISPUTE_RAISED: '⚠️',
  DISPUTE_RESOLVED: '⚖️',
  REPLACEMENT_REQUESTED: '🔄',
  ENGAGEMENT_CANCELLED: '❌',
  FUNDING_SHORTFALL_DETECTED: '🚨',
};

const TYPE_LABELS: Partial<Record<NotificationType, string>> = {
  ENGAGEMENT_CREATED: 'Engagement created',
  PROOF_SUBMITTED: 'Proof submitted',
  MILESTONE_CONFIRMED: 'Milestone confirmed',
  PAYMENT_RELEASED: 'Payment released',
  DISPUTE_RAISED: 'Dispute raised',
  DISPUTE_RESOLVED: 'Dispute resolved',
  REPLACEMENT_REQUESTED: 'Replacement requested',
  ENGAGEMENT_CANCELLED: 'Engagement cancelled',
  FUNDING_SHORTFALL_DETECTED: 'Funding shortfall detected',
};

export function isSlackKeyType(type: NotificationType): boolean {
  return SLACK_KEY_TYPES.includes(type);
}

/**
 * SlackNotificationsService
 *
 * Posts readable, human-friendly notification messages to a company's Slack
 * channel via an incoming webhook. Payloads use Slack Blocks (header +
 * message + footer link) — never the raw notification record or data JSON.
 */
@Injectable()
export class SlackNotificationsService {
  private readonly logger = new Logger(SlackNotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Build a Slack Blocks payload with a readable message (no raw JSON).
   */
  buildPayload(
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ): Record<string, any> {
    const emoji = TYPE_EMOJI[type] ?? '📬';
    const label = TYPE_LABELS[type] ?? this.humanizeType(type);
    const body = message?.trim() ? message.trim() : title;
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://app.hiresettle.com');

    const blocks: Record<string, any>[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${emoji} ${label}`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: this.escape(body) },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `HireSettle · <${frontendUrl}|View in HireSettle>`,
          },
        ],
      },
    ];

    // Keep the channel useful for events that carry structured context.
    const contextLine = this.buildContextLine(data);
    if (contextLine) {
      blocks.splice(2, 0, {
        type: 'section',
        text: { type: 'mrkdwn', text: contextLine },
      });
    }

    return { blocks };
  }

  /**
   * Post a notification to a Slack incoming webhook. Throws on failure so
   * queue retries (or the caller) can handle it.
   */
  async send(
    type: NotificationType,
    title: string,
    message: string,
    data: Record<string, any> | undefined,
    webhookUrl: string,
  ): Promise<void> {
    const payload = this.buildPayload(type, title, message, data);
    await axios.post(webhookUrl, payload, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.logger.log(`Slack notification sent for ${type} to ${webhookUrl}`);
  }

  private buildContextLine(data?: Record<string, any>): string | null {
    if (!data) return null;
    const parts: string[] = [];
    if (data.engagementTitle) parts.push(`*${this.escape(String(data.engagementTitle))}*`);
    if (data.milestoneIndex !== undefined && data.milestoneIndex !== null) {
      parts.push(`milestone *${data.milestoneIndex}*`);
    }
    if (data.amount) parts.push(this.escape(String(data.amount)));
    if (data.reason) parts.push(`reason: ${this.escape(String(data.reason))}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private humanizeType(type: NotificationType): string {
    return type.toLowerCase().replace(/_/g, ' ');
  }

  /** Escape Slack mrkdwn special characters so user content stays readable. */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
