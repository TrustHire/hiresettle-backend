import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@Injectable()
export class CostCentersService {
  private readonly logger = new Logger(CostCentersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateCostCenterDto) {
    try {
      const created = await this.prisma.costCenter.create({
        data: {
          companyId,
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          budget: BigInt(dto.budget),
        },
      });
      return this.serialize(created, 0n);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Cost center code "${dto.code}" already exists`);
      }
      throw error;
    }
  }

  async findAll(companyId: string) {
    const [centers, spendRows] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { companyId },
        orderBy: { code: 'asc' },
      }),
      this.prisma.engagement.groupBy({
        by: ['costCenterId'],
        where: { companyId, costCenterId: { not: null }, archivedAt: null },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ]);

    const spendByCenter = new Map<string, { spent: bigint; engagementCount: number }>();
    for (const row of spendRows) {
      if (row.costCenterId) {
        spendByCenter.set(row.costCenterId, {
          spent: row._sum.totalAmount ?? 0n,
          engagementCount: row._count.id,
        });
      }
    }

    return centers.map((c) => {
      const stats = spendByCenter.get(c.id);
      return this.serialize(c, stats?.spent ?? 0n, stats?.engagementCount ?? 0);
    });
  }

  async findOne(companyId: string, id: string) {
    const center = await this.prisma.costCenter.findFirst({
      where: { id, companyId },
    });
    if (!center) {
      throw new NotFoundException(`Cost center ${id} not found`);
    }
    const agg = await this.prisma.engagement.aggregate({
      where: { costCenterId: id, archivedAt: null },
      _sum: { totalAmount: true },
      _count: { id: true },
    });
    return this.serialize(center, agg._sum.totalAmount ?? 0n, agg._count.id);
  }

  async update(companyId: string, id: string, dto: UpdateCostCenterDto) {
    const existing = await this.prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException(`Cost center ${id} not found`);
    }

    try {
      const updated = await this.prisma.costCenter.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.code !== undefined && { code: dto.code.trim().toUpperCase() }),
          ...(dto.budget !== undefined && { budget: BigInt(dto.budget) }),
        },
      });
      const agg = await this.prisma.engagement.aggregate({
        where: { costCenterId: id, archivedAt: null },
        _sum: { totalAmount: true },
        _count: { id: true },
      });
      return this.serialize(updated, agg._sum.totalAmount ?? 0n, agg._count.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Cost center code "${dto.code}" already exists`);
      }
      throw error;
    }
  }

  async remove(companyId: string, id: string) {
    const existing = await this.prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException(`Cost center ${id} not found`);
    }
    await this.prisma.costCenter.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * Validates that `costCenterId` belongs to `companyId` and returns a non-blocking
   * warning string if adding `additionalAmount` exceeds the cost center's budget.
   */
  async checkBudgetWarning(
    companyId: string,
    costCenterId: string,
    additionalAmount: bigint,
  ): Promise<string | null> {
    const center = await this.prisma.costCenter.findFirst({
      where: { id: costCenterId, companyId },
    });
    if (!center) {
      throw new NotFoundException(`Cost center ${costCenterId} not found for this company`);
    }

    const agg = await this.prisma.engagement.aggregate({
      where: { costCenterId, archivedAt: null },
      _sum: { totalAmount: true },
    });
    const currentSpent = agg._sum.totalAmount ?? 0n;
    const projected = currentSpent + additionalAmount;

    if (projected > center.budget) {
      const warning =
        `Cost center ${center.code} (${center.name}) budget exceeded: ` +
        `projected ${projected.toString()} > budget ${center.budget.toString()}`;
      this.logger.warn(warning);
      return warning;
    }

    return null;
  }

  private serialize(
    center: {
      id: string;
      companyId: string;
      name: string;
      code: string;
      budget: bigint;
      createdAt: Date;
      updatedAt: Date;
    },
    spent: bigint,
    engagementCount = 0,
  ) {
    return {
      ...center,
      budget: center.budget.toString(),
      spent: spent.toString(),
      remaining: (center.budget - spent).toString(),
      overBudget: spent > center.budget,
      engagementCount,
    };
  }
}
