import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from './events.service';

const MAX_RETRIES = 5;

function backoffMs(retryCount: number): number {
  return Math.pow(2, retryCount) * 1_000; // 1s, 2s, 4s, 8s, 16s
}

@Injectable()
export class ChainEventRetryService {
  private readonly logger = new Logger(ChainEventRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async retryUnprocessed(): Promise<void> {
    const candidates = await this.prisma.chainEvent.findMany({
      where: { processed: false, retryCount: { lt: MAX_RETRIES } },
      orderBy: { ledger: 'asc' },
    });

    for (const event of candidates) {
      if (!this.isEligible(event.retryCount, event.lastErrorAt)) continue;

      try {
        await this.events.processChainEventRecord(event);
        this.logger.log(`Processed event ${event.id} (${event.eventName})`);
      } catch (error) {
        await this.recordFailure(event.id, event.retryCount, error);
      }
    }
  }

  async recordFailure(id: string, currentRetryCount: number, error: unknown): Promise<void> {
    const newCount = currentRetryCount + 1;
    await this.prisma.chainEvent.update({
      where: { id },
      data: { retryCount: newCount, lastErrorAt: new Date() },
    });

    this.logger.warn(
      `Event ${id} failed (attempt ${newCount}/${MAX_RETRIES}): ${(error as Error)?.message ?? error}`,
    );

    if (newCount >= MAX_RETRIES) {
      await this.moveToDeadLetter(id, (error as Error)?.message);
    }
  }

  async moveToDeadLetter(chainEventId: string, errorMessage?: string): Promise<void> {
    const event = await this.prisma.chainEvent.findUnique({ where: { id: chainEventId } });
    if (!event) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.deadLetterEvent.upsert({
        where: { originalId: chainEventId },
        create: {
          originalId: chainEventId,
          engagementId: event.engagementId ?? undefined,
          eventName: event.eventName,
          ledger: event.ledger,
          txHash: event.txHash,
          payload: event.payload as any,
          retryCount: event.retryCount,
          lastErrorAt: event.lastErrorAt,
          errorMessage,
        },
        update: {
          retryCount: event.retryCount,
          lastErrorAt: event.lastErrorAt,
          errorMessage,
        },
      });

      await tx.chainEvent.delete({ where: { id: chainEventId } });
    });

    this.logger.warn(
      `Event ${chainEventId} moved to dead-letter queue after ${event.retryCount} retries`,
    );
  }

  private isEligible(retryCount: number, lastErrorAt: Date | null): boolean {
    if (!lastErrorAt) return true;
    return Date.now() - lastErrorAt.getTime() >= backoffMs(retryCount);
  }
}
