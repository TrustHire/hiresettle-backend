import { Injectable, NotFoundException, CACHE_MANAGER, Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EngagementStatus, MilestoneStatus, MilestoneKind } from '@prisma/client';

interface CurrentUser {
  id: string;
  stellarAddress?: string;
  role: string;
}

@Injectable()
export class RecruitersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getStats(user: CurrentUser) {
    if (!user.stellarAddress) {
      throw new NotFoundException('Recruiter not found');
    }

    const cacheKey = `recruiter-stats:${user.id}`;
    let stats = await this.cacheManager.get(cacheKey);
    if (stats) {
      return stats;
    }

    const recruiterAddress = user.stellarAddress;

    // Get all engagements for recruiter
    const engagements = await this.prisma.engagement.findMany({
      where: { recruiterAddress },
      include: { milestones: true },
    });

    // Calculate metrics
    const totalEngagements = engagements.length;
    const completedCount = engagements.filter(e => e.status === EngagementStatus.COMPLETED).length;

    let totalEarned = BigInt(0);
    let completedWithRetention = 0;
    let retentionSuccessCount = 0;

    const activeDisputesCount = engagements.filter(e => 
      e.milestones.some(m => m.status === MilestoneStatus.DISPUTED)
    ).length;

    for (const engagement of engagements) {
      totalEarned += engagement.releasedAmount;

      // Check if has any retention milestones
      const hasRetentionMilestones = engagement.milestones.some(m => m.kind === MilestoneKind.RETENTION);
      if (hasRetentionMilestones && engagement.status === EngagementStatus.COMPLETED) {
        completedWithRetention++;
        // Check if all retention milestones confirmed
        const allRetentionConfirmed = engagement.milestones
          .filter(m => m.kind === MilestoneKind.RETENTION)
          .every(m => m.status === MilestoneStatus.CONFIRMED);
        if (allRetentionConfirmed) {
          retentionSuccessCount++;
        }
      }
    }

    const averageRetentionRate = completedWithRetention > 0 ? 
      Math.round((retentionSuccessCount / completedWithRetention) * 100) : 0;

    const result = {
      totalEngagements,
      completedCount,
      averageRetentionRate,
      totalEarned: totalEarned.toString(),
      activeDisputes: activeDisputesCount,
    };

    await this.cacheManager.set(cacheKey, result, 300000); // 5 minutes in ms

    return result;
  }

  async getEngagements(user: CurrentUser, page = 1, limit = 20) {
    if (!user.stellarAddress) {
      throw new NotFoundException('Recruiter not found');
    }

    const recruiterAddress = user.stellarAddress;

    const where = { recruiterAddress };
    const [engagements, total] = await this.prisma.$transaction([
      this.prisma.engagement.findMany({
        where,
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.engagement.count({ where }),
    ]);

    const serializedEngagements = engagements.map(this.serializeEngagement);
    return {
      data: serializedEngagements,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private serializeEngagement(engagement: any) {
    return {
      ...engagement,
      totalAmount: engagement.totalAmount?.toString(),
      releasedAmount: engagement.releasedAmount?.toString(),
      milestones: engagement.milestones?.map((m: any) => ({
        ...m,
        paymentReleased: m.paymentReleased?.toString() ?? null,
      })),
    };
  }
}
