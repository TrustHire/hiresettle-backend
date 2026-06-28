import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AdminDeadLetterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page = 1, limit = 20) {
    const [events, total] = await this.prisma.$transaction([
      this.prisma.deadLetterEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deadLetterEvent.count(),
    ]);
    return { data: events, meta: { total, page, limit } };
  }

  async requeue(id: string): Promise<{ message: string }> {
    const dead = await this.prisma.deadLetterEvent.findUnique({ where: { id } });
    if (!dead) throw new NotFoundException(`Dead-letter event ${id} not found`);

    await this.prisma.$transaction(async (tx) => {
      await tx.chainEvent.create({
        data: {
          id: dead.originalId,
          engagementId: dead.engagementId ?? undefined,
          eventName: dead.eventName,
          ledger: dead.ledger,
          txHash: dead.txHash,
          payload: dead.payload as any,
          processed: false,
          retryCount: 0,
          lastErrorAt: null,
        },
      });
      await tx.deadLetterEvent.delete({ where: { id } });
    });

    return { message: `Event ${dead.originalId} requeued for processing` };
  }
}
