import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { WebhookDeliveryStatus } from "@prisma/client";
import { SUPPORTED_WEBHOOK_EVENTS, WebhookEventType } from "./create-webhook-subscription.dto";

export class ListWebhookDeliveriesDto {
  @ApiPropertyOptional({ enum: WebhookDeliveryStatus, example: "FAILED" })
  @IsOptional()
  @IsEnum(WebhookDeliveryStatus)
  status?: WebhookDeliveryStatus;

  @ApiPropertyOptional({ enum: SUPPORTED_WEBHOOK_EVENTS, example: "DISPUTE_RAISED" })
  @IsOptional()
  @IsEnum(SUPPORTED_WEBHOOK_EVENTS)
  eventType?: WebhookEventType;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
