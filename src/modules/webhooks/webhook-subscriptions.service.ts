import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { WebhookEventType } from "./dto/create-webhook-subscription.dto";

@Injectable()
export class WebhookSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    url: string,
    eventTypes?: WebhookEventType[],
  ) {
    return this.prisma.webhookSubscription.create({
      data: { companyId, url, eventTypes: eventTypes ?? [] },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });
  }

  async remove(id: string, companyId: string) {
    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!subscription)
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (subscription.companyId !== companyId) {
      throw new ForbiddenException(
        "Not authorized to remove this webhook subscription",
      );
    }
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Checks whether a subscription should receive a given event type.
   * Empty eventTypes array = all events (#275).
   */
  shouldDeliver(eventTypes: string[], eventType: string): boolean {
    return eventTypes.length === 0 || eventTypes.includes(eventType);
  }

  /**
   * Replay historical webhook delivery logs for a subscription within a date range (#274).
   * Re-sends only events already logged — no fabricated events.
   */
  async replay(
    id: string,
    companyId: string,
    from: Date,
    to: Date,
    webhooksService: {
      sendWebhook: (url: string, payload: any, meta: any) => Promise<void>;
    },
    secret?: string,
  ) {
    if (from > to) throw new BadRequestException("from must be before to");

    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!subscription)
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (subscription.companyId !== companyId) {
      throw new ForbiddenException(
        "Not authorized to replay this subscription",
      );
    }

    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: {
        userId: companyId,
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });

    let replayed = 0;
    for (const delivery of deliveries) {
      if (!this.shouldDeliver(subscription.eventTypes, delivery.event))
        continue;

      await webhooksService.sendWebhook(
        subscription.url,
        delivery.payload as any,
        { userId: companyId, secret },
      );

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "RESENT",
          resendCount: { increment: 1 },
          lastResendAt: new Date(),
        },
      });

      replayed++;
    }

    return { replayed, subscriptionId: id };
  }
}
