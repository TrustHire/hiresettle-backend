import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NotificationType } from '@prisma/client';
import { SLACK_KEY_TYPES, isSlackKeyType } from './slack-notifications.service';

// Teams mirrors the same event selection as Slack and Discord (#391)
export const TEAMS_KEY_TYPES = SLACK_KEY_TYPES;
export { isSlackKeyType as isTeamsKeyType };

export const ADAPTIVE_CARD_CONTENT_TYPE = 'application/vnd.microsoft.card.adaptive';
export const ADAPTIVE_CARD_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';

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

// Adaptive Card text colors used to flag attention-worthy events.
const TYPE_COLOR: Partial<Record<NotificationType, string>> = {
  DISPUTE_RAISED: 'Warning',
  ENGAGEMENT_CANCELLED: 'Attention',
  FUNDING_SHORTFALL_DETECTED: 'Attention',
  PAYMENT_RELEASED: 'Good',
  MILESTONE_CONFIRMED: 'Good',
};

/**
 * TeamsNotificationsService
 *
 * Posts notification messages to a company's Microsoft Teams channel via an
 * incoming webhook. Payloads are Adaptive Cards (title, message, key facts and
 * a link back to the app) — never the raw notification record (#391).
 */
@Injectable()
export class TeamsNotificationsService {
  private readonly logger = new Logger(TeamsNotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Build a Teams message wrapping a single Adaptive Card attachment.
   */
  buildPayload(
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ): Record<string, any> {
    const emoji = TYPE_EMOJI[type] ?? '📬';
    const body = message?.trim() ? message.trim() : title;
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://app.hiresettle.com');

    const cardBody: Record<string, any>[] = [
      {
        type: 'TextBlock',
        text: `${emoji} ${title}`,
        size: 'Large',
        weight: 'Bolder',
        wrap: true,
        ...(TYPE_COLOR[type] ? { color: TYPE_COLOR[type] } : {}),
      },
      {
        type: 'TextBlock',
        text: body,
        wrap: true,
      },
    ];

    const facts = this.buildFacts(data);
    if (facts.length > 0) {
      cardBody.push({ type: 'FactSet', facts });
    }

    cardBody.push({
      type: 'TextBlock',
      text: 'HireSettle',
      size: 'Small',
      isSubtle: true,
      spacing: 'Medium',
    });

    return {
      type: 'message',
      attachments: [
        {
          contentType: ADAPTIVE_CARD_CONTENT_TYPE,
          contentUrl: null,
          content: {
            $schema: ADAPTIVE_CARD_SCHEMA,
            type: 'AdaptiveCard',
            version: '1.4',
            body: cardBody,
            actions: [
              {
                type: 'Action.OpenUrl',
                title: 'View in HireSettle',
                url: frontendUrl,
              },
            ],
          },
        },
      ],
    };
  }

  /**
   * Post a notification to a Teams incoming webhook. Throws on failure so
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
    this.logger.log(`Teams notification sent for ${type}`);
  }

  private buildFacts(data?: Record<string, any>): { title: string; value: string }[] {
    if (!data) return [];
    const facts: { title: string; value: string }[] = [];
    if (data.engagementTitle) facts.push({ title: 'Engagement', value: String(data.engagementTitle) });
    if (data.milestoneIndex !== undefined && data.milestoneIndex !== null) {
      facts.push({ title: 'Milestone', value: String(data.milestoneIndex) });
    }
    if (data.amount) facts.push({ title: 'Amount', value: String(data.amount) });
    if (data.reason) facts.push({ title: 'Reason', value: String(data.reason) });
    return facts;
  }
}
