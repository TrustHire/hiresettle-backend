import { Injectable, NotFoundException, Inject, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EngagementStatus, MilestoneStatus, MilestoneKind, UserRole } from '@prisma/client';
import { SearchRecruitersDto } from './dto/search-recruiters.dto';
import { cursorPage } from '../../common/pagination/cursor-pagination';
import { RecruiterReviewsService } from './recruiter-reviews.service';

interface CurrentUser {
  id: string;
  stellarAddress?: string | null;
  role: string;
}

@Injectable()
export class RecruitersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Optional() private readonly reviewsService?: RecruiterReviewsService,
  ) {}

  async listRecruiters({
    search,
    minRating,
    region,
    page = 1,
    limit = 20,
    cursor,
  }: SearchRecruitersDto = {}) {
    const trimmedSearch = search?.trim();
    const trimmedRegion = region?.trim();

    let ratingFilter: Prisma.UserWhereInput = {};
    if (minRating !== undefined && minRating !== null) {
      const numericMinRating = Number(minRating);
      if (typeof (this.prisma as any).recruiterReview?.groupBy === 'function') {
        const grouped = await this.prisma.recruiterReview.groupBy({
          by: ['recruiterId'],
          _avg: { rating: true },
          having: {
            rating: {
              _avg: { gte: numericMinRating },
            },
          },
        });
        if (Array.isArray(grouped)) {
          const qualifiedIds = grouped
            .filter((row: any) => (row._avg?.rating ?? numericMinRating) >= numericMinRating)
            .map((row: any) => row.recruiterId);
          ratingFilter =
            qualifiedIds.length > 0
              ? {
                  OR: [
                    { averageRating: { gte: numericMinRating } },
                    { id: { in: qualifiedIds } },
                  ],
                }
              : { averageRating: { gte: numericMinRating } };
        } else {
          ratingFilter = { averageRating: { gte: numericMinRating } };
        }
      } else {
        ratingFilter = { averageRating: { gte: numericMinRating } };
      }
    }

    const where: Prisma.UserWhereInput = {
      role: UserRole.RECRUITER,
      deactivatedAt: null,
      ...(trimmedSearch
        ? { name: { contains: trimmedSearch, mode: 'insensitive' } }
        : {}),
      ...(trimmedRegion
        ? { region: { equals: trimmedRegion, mode: 'insensitive' } }
        : {}),
      ...ratingFilter,
    };

    if (cursor) {
      const data = await this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          stellarAddress: true,
          avatarUrl: true,
          region: true,
          averageRating: true,
          createdAt: true,
        },
        cursor: { id: cursor },
        skip: 1,
        take: limit + 1,
        orderBy: { name: 'asc' },
      });
      const pageResult = cursorPage(data, limit);
      return { data: pageResult.data, meta: { limit, nextCursor: pageResult.nextCursor } };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          stellarAddress: true,
          avatarUrl: true,
          region: true,
          averageRating: true,
          kycStatus: true,
          createdAt: true,
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    if (!this.reviewsService) {
      return {
        data,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    const ratings = await this.reviewsService.getAverageRatings(data.map((r) => r.id));
    const withRatings = data.map((r) => ({
      ...r,
      averageRating: ratings.get(r.id) ?? (r as any).averageRating ?? null,
    }));

    return {
      data: withRatings,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

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
      where: { recruiterAddress, archivedAt: null },
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

    const averageRating = (await this.reviewsService?.getAverageRating(user.id)) ?? null;

    const result = {
      totalEngagements,
      completedCount,
      averageRetentionRate,
      averageRating,
      totalEarned: totalEarned.toString(),
      activeDisputes: activeDisputesCount,
    };

    await this.cacheManager.set(cacheKey, result, 300000); // 5 minutes in ms

    return result;
  }

  async getEngagements(user: CurrentUser, page = 1, limit = 20, cursor?: string) {
    if (!user.stellarAddress) {
      throw new NotFoundException('Recruiter not found');
    }

    const recruiterAddress = user.stellarAddress;

    const where = { recruiterAddress, archivedAt: null };
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
