import { Controller, Post, Param, NotFoundException, BadRequestException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('subscriptions/:id/rotate-secret')
  async rotateSecret(@Param('id') id: string) {
    const subscription = await this.webhooksService.findById(id);
    if (!subscription) {
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    }

    const { secret, previousSecret, previousSecretExpiresAt } =
      await this.webhooksService.rotateSecret(id);

    return {
      id,
      secret,
      previousSecret,
      previousSecretExpiresAt,
    };
  }
}
