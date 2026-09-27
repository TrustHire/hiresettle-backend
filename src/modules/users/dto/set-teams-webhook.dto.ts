import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class SetTeamsWebhookDto {
  @ApiProperty({
    example: 'https://example.webhook.office.com/webhookb2/<id>/IncomingWebhook/<token>',
    description: 'Microsoft Teams incoming-webhook URL for notification alerts (#391)',
  })
  @IsUrl({ require_tld: false, protocols: ['https'] }, {
    message: 'url must be a valid https Microsoft Teams incoming-webhook URL',
  })
  url: string;
}
