import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ListUsersDto } from './dto/list-users.dto';
import { Prisma, UserRole, MilestoneStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CacheService } from '../../common/cache/cache.service';
import { cursorPage } from '../../common/pagination/cursor-pagination';

const USER_SELECT = {
  id: true,
  email: true,
  stellarAddress: true,
  name: true,
  company: true,
  role: true,
  deactivatedAt: true,
  rateLimitOverride: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsersService {
  private static readonly METRICS_CACHE_KEY = 'admin:metrics';
  private static readonly METRICS_TTL_S = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  async listUsers(dto: ListUsersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      ...(dto.role ? { role: dto.role } : {}),
      ...(dto.search
        ? {
            OR: [
              { name: { contains: dto.search, mode: 'insensitive' } },
              { email: { contains: dto.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

      if (dto.cursor) {
        const users = await this.prisma.user.findMany({
          where,
          select: USER_SELECT,
          cursor: { id: dto.cursor },
          skip: 1,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
        });
        const pageResult = cursorPage(users, limit);
        return { data: pageResult.data, meta: { limit, nextCursor: pageResult.nextCursor } };
      }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: USER_SELECT, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async deactivateUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deactivatedAt) throw new BadRequestException('User is already deactivated');

    return this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: new Date() },
      select: USER_SELECT,
    });
  }

  async reactivateUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deactivatedAt) throw new BadRequestException('User is not deactivated');

    return this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: null },
      select: USER_SELECT,
    });
  }

  async setCompanyVerification(id: string, verified: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.COMPANY) {
      throw new BadRequestException('Only company users can be verified');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { verifiedAt: verified ? new Date() : null },
      select: USER_SELECT,
    });

    if (user.stellarAddress) {
      await this.cache.del(`user:profile:${user.stellarAddress}`);
    }

    return updated;
  }

  async assignArbiter(engagementId: string, arbiterId: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      include: { arbiter: true },
    });
    if (!engagement) throw new NotFoundException('Engagement not found');

    const newArbiter = await this.prisma.user.findUnique({
      where: { id: arbiterId },
    });
    if (!newArbiter) throw new NotFoundException('Arbiter not found');
    if (newArbiter.role !== UserRole.ARBITER) throw new BadRequestException('User is not an arbiter');
    if (!newArbiter.stellarAddress) throw new BadRequestException('Arbiter has no stellar address');

    const updated = await this.prisma.engagement.update({
      where: { id: engagementId },
      data: { arbiterAddress: newArbiter.stellarAddress },
      include: { arbiter: true },
    });

    const isReassignment = !!engagement.arbiter;

    // Notify old arbiter
    if (isReassignment && engagement.arbiter) {
      await this.notificationsService.notifyUserById(
        engagement.arbiter.id,
        'ARBITER_REASSIGNED',
        'Arbiter Reassigned',
        `You have been removed as arbiter from engagement ${engagementId}`,
        { engagementId },
      );
    }

    // Notify new arbiter
    await this.notificationsService.notifyUserById(
      newArbiter.id,
      'ARBITER_ASSIGNED',
      'Arbiter Assigned',
      `You have been assigned as arbiter to engagement ${engagementId}`,
      { engagementId },
    );

    return updated;
  }

  async listArbiters() {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.ARBITER,
        deactivatedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        stellarAddress: true,
        createdAt: true,
      },
    });
  }

  async getAdminMetrics() {
    const cached = await this.cache.get<object>(AdminUsersService.METRICS_CACHE_KEY);
    if (cached) return cached;

    // Execute all metrics queries in parallel for better performance
    const [
      engagementsByStatus,
      milestoneVolume,
      releasedAmount,
      activeDisputes,
      usersByRole,
      totalEngagements,
      totalDisputedMilestones,
      arbiters,
    ] = await Promise.all([
      // Total engagements by status
      this.prisma.engagement.groupBy({
        by: ['status'],
        _count: true,
        where: { archivedAt: null },
      }),
      
      // Total milestone volume (sum of totalAmount across all engagements)
      this.prisma.engagement.aggregate({
        _sum: {
          totalAmount: true,
        },
        where: { archivedAt: null },
      }),
      
      // Total released amount across all engagements
      this.prisma.engagement.aggregate({
        _sum: {
          releasedAmount: true,
        },
        where: { archivedAt: null },
      }),
      
      // Active disputes count (milestones with DISPUTED status)
      this.prisma.milestone.count({
        where: { status: MilestoneStatus.DISPUTED },
      }),
      
      // Registered users by role
      this.prisma.user.groupBy({
        by: ['role'],
        _count: true,
        where: {
          deactivatedAt: null, // Only count active users
        },
      }),
      
      // Total engagements (for backward compatibility)
      this.prisma.engagement.count({
        where: { archivedAt: null },
      }),
      
      // Total disputed milestones (for backward compatibility)
      this.prisma.milestone.count({
        where: { status: MilestoneStatus.DISPUTED },
      }),
      
      // Get arbiters with active disputes count (for backward compatibility)
      this.prisma.user.findMany({
        where: { role: UserRole.ARBITER },
        include: {
          arbiterEngagements: {
            where: { archivedAt: null },
            include: {
              milestones: {
                where: { status: MilestoneStatus.DISPUTED },
              },
            },
          },
        },
      }),
    ]);

    // Calculate locked amount (totalAmount - releasedAmount)
    const totalVolume = milestoneVolume._sum.totalAmount || BigInt(0);
    const totalReleased = releasedAmount._sum.releasedAmount || BigInt(0);
    const lockedAmount = totalVolume - totalReleased;

    // Format engagements by status
    const engagementsByStatusFormatted = engagementsByStatus.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    // Format users by role
    const usersByRoleFormatted = usersByRole.reduce((acc, item) => {
      acc[item.role] = item._count;
      return acc;
    }, {} as Record<string, number>);

    // Format arbiter workload (for backward compatibility)
    const arbiterWorkload = arbiters.map((arbiter) => {
      const activeDisputes = arbiter.arbiterEngagements.reduce((count, eng) => {
        return count + eng.milestones.length;
      }, 0);

      return {
        arbiterId: arbiter.id,
        name: arbiter.name,
        email: arbiter.email,
        activeDisputes,
      };
    });

    const result = {
      // New metrics as requested
      engagements: {
        byStatus: engagementsByStatusFormatted,
        total: totalEngagements,
      },
      milestones: {
        totalVolume: totalVolume.toString(),
        releasedAmount: totalReleased.toString(),
        lockedAmount: lockedAmount.toString(),
      },
      disputes: {
        activeCount: activeDisputes,
      },
      users: {
        byRole: usersByRoleFormatted,
        totalActive: Object.values(usersByRoleFormatted).reduce((sum, count) => sum + count, 0),
      },
      // Backward compatible metrics
      totalEngagements,
      totalDisputedMilestones,
      arbiterWorkload,
    };
    
    await this.cache.set(AdminUsersService.METRICS_CACHE_KEY, result, AdminUsersService.METRICS_TTL_S);
    return result;
  }

  async invalidateMetricsCache(): Promise<void> {
    await this.cache.del(AdminUsersService.METRICS_CACHE_KEY);
  }

  async setRateLimitOverride(id: string, limit: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: { rateLimitOverride: limit },
      select: USER_SELECT,
    });
  }

  async clearRateLimitOverride(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: { rateLimitOverride: null },
      select: USER_SELECT,
    });
  }
}
