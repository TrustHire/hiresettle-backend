import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class SetSlackWebhookDto {
  @ApiProperty({
    example: 'https://hooks.slack.com/services/<team-id>/<webhook-id>/<token>',
    description: 'Slack incoming-webhook URL for notification alerts',
  })
  @IsUrl({ require_tld: false, protocols: ['https'] }, {
    message: 'url must be a valid https Slack incoming-webhook URL',
  })
  url: string;
}
