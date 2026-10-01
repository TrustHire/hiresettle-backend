import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IncomingPaymentPollerService } from './incoming-payment-poller.service';
import { UnmatchedPaymentStatus } from '@prisma/client';

export class MatchPaymentDto {
  engagementId: string;
  notes?: string;
}

export class RefundPaymentDto {
  notes?: string;
}

export class IgnorePaymentDto {
  notes?: string;
}

@Injectable()
export class UnmatchedPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly poller: IncomingPaymentPollerService,
  ) {}

  // ----------------------------------------------------------
  // LIST
  // ----------------------------------------------------------

  async list(
    status?: UnmatchedPaymentStatus,
    page = 1,
    limit = 20,
  ) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.unmatchedPayment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.unmatchedPayment.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const record = await this.prisma.unmatchedPayment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Unmatched payment ${id} not found`);
    return record;
  }

  // ----------------------------------------------------------
  // MATCH — admin links a payment to an engagement
  // ----------------------------------------------------------

  async match(id: string, adminId: string, dto: MatchPaymentDto) {
    const record = await this.prisma.unmatchedPayment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Unmatched payment ${id} not found`);
    if (record.status !== UnmatchedPaymentStatus.PENDING) {
      throw new ConflictException(`Payment is already ${record.status} — cannot match`);
    }

    const engagement = await this.prisma.engagement.findUnique({
      where: { id: dto.engagementId },
      select: { id: true, status: true },
    });
    if (!engagement) {
      throw new BadRequestException(`Engagement ${dto.engagementId} not found`);
    }

    const updated = await this.prisma.unmatchedPayment.update({
      where: { id },
      data: {
        status: UnmatchedPaymentStatus.MATCHED,
        matchedEngagementId: dto.engagementId,
        resolvedBy: adminId,
        resolvedAt: new Date(),
        notes: dto.notes ?? null,
      },
    });

    await this.poller.syncPendingGauge();
    return updated;
  }

  // ----------------------------------------------------------
  // REFUND — admin marks payment as refunded off-platform
  // ----------------------------------------------------------

  async refund(id: string, adminId: string, dto: RefundPaymentDto) {
    const record = await this.prisma.unmatchedPayment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Unmatched payment ${id} not found`);
    if (record.status !== UnmatchedPaymentStatus.PENDING) {
      throw new ConflictException(`Payment is already ${record.status} — cannot refund`);
    }

    const updated = await this.prisma.unmatchedPayment.update({
      where: { id },
      data: {
        status: UnmatchedPaymentStatus.REFUNDED,
        resolvedBy: adminId,
        resolvedAt: new Date(),
        notes: dto.notes ?? null,
      },
    });

    await this.poller.syncPendingGauge();
    return updated;
  }

  // ----------------------------------------------------------
  // IGNORE — admin dismisses a payment (e.g. known spam/dust)
  // ----------------------------------------------------------

  async ignore(id: string, adminId: string, dto: IgnorePaymentDto) {
    const record = await this.prisma.unmatchedPayment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Unmatched payment ${id} not found`);
    if (record.status !== UnmatchedPaymentStatus.PENDING) {
      throw new ConflictException(`Payment is already ${record.status} — cannot ignore`);
    }

    const updated = await this.prisma.unmatchedPayment.update({
      where: { id },
      data: {
        status: UnmatchedPaymentStatus.IGNORED,
        resolvedBy: adminId,
        resolvedAt: new Date(),
        notes: dto.notes ?? null,
      },
    });

    await this.poller.syncPendingGauge();
    return updated;
  }
}
