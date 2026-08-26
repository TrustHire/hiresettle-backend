import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWebhookSubscriptionDto {
  @ApiProperty({ example: 'https://example.com/webhooks/hiresettle' })
  @IsString() @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'url must be a valid https:// URL' })
  url: string;
}
