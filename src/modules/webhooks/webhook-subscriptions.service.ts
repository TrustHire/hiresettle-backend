import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class WebhookSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, url: string) {
    return this.prisma.webhookSubscription.create({
      data: { companyId, url },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(id: string, companyId: string) {
    const subscription = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (subscription.companyId !== companyId) {
      throw new ForbiddenException('Not authorized to remove this webhook subscription');
    }
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { success: true };
  }
}
