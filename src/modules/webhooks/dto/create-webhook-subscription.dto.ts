import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// Mirror the webhook event types exposed by WebhooksService.listSupportedEvents()
export const SUPPORTED_WEBHOOK_EVENTS = [
  "COMPLETED",
  "CANCELLED",
  "REPLACEMENT_REQUESTED",
  "DISPUTE_RAISED",
  "PAYMENT_RELEASED",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export class CreateWebhookSubscriptionDto {
  @ApiProperty({ example: "https://example.com/webhooks/hiresettle" })
  @IsString()
  @IsNotEmpty()
  @IsUrl(
    { protocols: ["https"], require_protocol: true },
    { message: "url must be a valid https:// URL" },
  )
  url: string;

  @ApiPropertyOptional({
    type: [String],
    enum: SUPPORTED_WEBHOOK_EVENTS,
    example: ["COMPLETED", "DISPUTE_RAISED"],
    description: "Event types to receive. Empty or omitted = all events (#275)",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(SUPPORTED_WEBHOOK_EVENTS, { each: true })
  eventTypes?: WebhookEventType[];
}
