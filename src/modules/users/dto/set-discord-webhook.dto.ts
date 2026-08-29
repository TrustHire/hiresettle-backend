import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsUrl } from "class-validator";

export class SetDiscordWebhookDto {
  @ApiProperty({
    example: "https://discord.com/api/webhooks/<channel-id>/<token>",
    description: "Discord incoming-webhook URL for notification alerts (#278)",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsUrl(
    { require_tld: false, protocols: ["https"] },
    {
      message: "url must be a valid https Discord incoming-webhook URL",
    },
  )
  url?: string;
}
