import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { WebhookEventType } from "./dto/create-webhook-subscription.dto";
import { ListWebhookDeliveriesDto } from "./dto/list-webhook-deliveries.dto";

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
   * Paginated delivery log for a subscription (#397). Only the owning
   * company can read it; the payload itself is omitted from the listing.
   */
  async listDeliveries(
    id: string,
    companyId: string,
    query: ListWebhookDeliveriesDto,
  ) {
    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!subscription)
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (subscription.companyId !== companyId) {
      throw new ForbiddenException(
        "Not authorized to view deliveries for this subscription",
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.WebhookDeliveryWhereInput = { subscriptionId: id };
    if (query.status) where.status = query.status;
    if (query.eventType) where.event = query.eventType;

    const [data, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          event: true,
          status: true,
          responseCode: true,
          attempts: true,
          errorMessage: true,
          resendCount: true,
          lastResendAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
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
        { userId: companyId, secret, subscriptionId: id },
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
