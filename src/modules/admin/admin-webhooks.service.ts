import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WebhooksService, WebhookPayload } from '../webhooks/webhooks.service';

@Injectable()
export class AdminWebhooksService {
  private readonly logger = new Logger(AdminWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  async resendDelivery(id: string, adminUserId?: string): Promise<{ message: string }> {
    const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id } });
    if (!delivery) throw new NotFoundException(`Webhook delivery ${id} not found`);

    const user = delivery.userId
      ? await this.prisma.user.findUnique({ where: { id: delivery.userId } })
      : null;

    await this.webhooks.sendWebhook(delivery.url, delivery.payload as unknown as WebhookPayload, {
      userId: delivery.userId ?? undefined,
      secret: user?.webhookSecret ?? undefined,
    });

    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'RESENT',
        resendCount: { increment: 1 },
        lastResendAt: new Date(),
      },
    });

    this.logger.log(
      `Webhook delivery ${id} (event: ${delivery.event}) manually resent by admin ${adminUserId ?? 'unknown'}`,
    );

    return { message: `Webhook delivery ${id} queued for resend` };
  }
}
