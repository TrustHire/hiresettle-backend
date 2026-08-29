import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { NotificationType } from "@prisma/client";
import { SLACK_KEY_TYPES, isSlackKeyType } from "./slack-notifications.service";

// Discord mirrors the same event selection as Slack (#278)
export const DISCORD_KEY_TYPES = SLACK_KEY_TYPES;
export { isSlackKeyType as isDiscordKeyType };

const TYPE_EMOJI: Partial<Record<NotificationType, string>> = {
  ENGAGEMENT_CREATED: "🎉",
  PROOF_SUBMITTED: "📄",
  MILESTONE_CONFIRMED: "✅",
  PAYMENT_RELEASED: "💰",
  DISPUTE_RAISED: "⚠️",
  DISPUTE_RESOLVED: "⚖️",
  REPLACEMENT_REQUESTED: "🔄",
  ENGAGEMENT_CANCELLED: "❌",
  FUNDING_SHORTFALL_DETECTED: "🚨",
};

/**
 * DiscordNotificationsService
 *
 * Posts notification messages to a company's Discord channel via an
 * incoming webhook. Uses Discord's `embeds` format — mirroring the Slack
 * integration's event selection (#278).
 */
@Injectable()
export class DiscordNotificationsService {
  private readonly logger = new Logger(DiscordNotificationsService.name);

  buildPayload(
    type: NotificationType,
    title: string,
    message: string,
  ): Record<string, any> {
    const emoji = TYPE_EMOJI[type] ?? "📬";
    return {
      embeds: [
        {
          title: `${emoji} ${title}`,
          description: message?.trim() || title,
          color: 0x5865f2, // Discord blurple
          footer: { text: "HireSettle" },
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  async send(
    type: NotificationType,
    title: string,
    message: string,
    webhookUrl: string,
  ): Promise<void> {
    const payload = this.buildPayload(type, title, message);
    await axios.post(webhookUrl, payload, {
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });
    this.logger.log(`Discord notification sent for ${type}`);
  }
}
