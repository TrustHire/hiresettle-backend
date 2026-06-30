import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SecurityEventAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListSecurityEventsDto } from './dto/list-security-events.dto';

export interface LogSecurityEventInput {
  userId?: string | null;
  action: SecurityEventAction;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class SecurityEventsService {
  constructor(private readonly prisma: PrismaService) {}

  // Append-only: there is intentionally no update/delete method on this service.
  async log(input: LogSecurityEventInput) {
    return this.prisma.securityEvent.create({
      data: {
        userId: input.userId ?? undefined,
        action: input.action,
        ip: input.ip ?? undefined,
        userAgent: input.userAgent ?? undefined,
      },
    });
  }

  async list(dto: ListSecurityEventsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const where: Prisma.SecurityEventWhereInput = {
      ...(dto.userId ? { userId: dto.userId } : {}),
      ...(dto.from || dto.to
        ? {
            createdAt: {
              ...(dto.from ? { gte: this.parseDate(dto.from) } : {}),
              ...(dto.to ? { lte: this.parseDate(dto.to) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.securityEvent.count({ where }),
    ]);

    return { data, meta: { total, page, limit } };
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format. Use ISO 8601 (e.g. 2026-01-01).');
    }
    return date;
  }
}
