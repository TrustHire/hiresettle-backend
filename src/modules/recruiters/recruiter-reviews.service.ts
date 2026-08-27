import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EngagementStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRecruiterReviewDto } from './dto/create-recruiter-review.dto';

@Injectable()
export class RecruiterReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async submitReview(
    engagementId: string,
    reviewer: { id: string; stellarAddress?: string | null; role: string },
    dto: CreateRecruiterReviewDto,
  ) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      include: { review: true },
    });
    if (!engagement) throw new NotFoundException('Engagement not found');

    if (engagement.status !== EngagementStatus.COMPLETED) {
      throw new BadRequestException('Reviews can only be submitted for completed engagements');
    }

    const isCompany =
      engagement.companyId === reviewer.id ||
      (!!reviewer.stellarAddress && engagement.companyAddress === reviewer.stellarAddress);

    if (!isCompany) {
      throw new ForbiddenException('Only the company on this engagement can leave a review');
    }

    if (engagement.review) {
      throw new ConflictException('A review has already been submitted for this engagement');
    }

    const recruiter = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(engagement.recruiterId ? [{ id: engagement.recruiterId }] : []),
          { stellarAddress: engagement.recruiterAddress },
        ],
        role: UserRole.RECRUITER,
      },
    });
    if (!recruiter) {
      throw new NotFoundException('Recruiter for this engagement not found');
    }

    try {
      return await this.prisma.recruiterReview.create({
        data: {
          engagementId,
          recruiterId: recruiter.id,
          reviewerId: reviewer.id,
          rating: dto.rating,
          comment: dto.comment,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A review has already been submitted for this engagement');
      }
      throw error;
    }
  }

  async listReviews(recruiterId: string, page = 1, limit = 20) {
    const recruiter = await this.prisma.user.findUnique({
      where: { id: recruiterId },
      select: { id: true, role: true },
    });
    if (!recruiter || recruiter.role !== UserRole.RECRUITER) {
      throw new NotFoundException('Recruiter not found');
    }

    const where = { recruiterId };
    const [data, total, avg] = await this.prisma.$transaction([
      this.prisma.recruiterReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          engagementId: true,
          rating: true,
          comment: true,
          createdAt: true,
          reviewer: { select: { id: true, name: true, company: true } },
        },
      }),
      this.prisma.recruiterReview.count({ where }),
      this.prisma.recruiterReview.aggregate({
        where,
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        averageRating: avg._avg.rating != null ? Math.round(avg._avg.rating * 10) / 10 : null,
        reviewCount: avg._count.rating,
      },
    };
  }

  async getAverageRating(recruiterId: string): Promise<number | null> {
    const avg = await this.prisma.recruiterReview.aggregate({
      where: { recruiterId },
      _avg: { rating: true },
    });
    return avg._avg.rating != null ? Math.round(avg._avg.rating * 10) / 10 : null;
  }

  async getAverageRatings(recruiterIds: string[]): Promise<Map<string, number | null>> {
    if (recruiterIds.length === 0) return new Map();
    const rows = await this.prisma.recruiterReview.groupBy({
      by: ['recruiterId'],
      where: { recruiterId: { in: recruiterIds } },
      _avg: { rating: true },
    });
    const map = new Map<string, number | null>();
    for (const id of recruiterIds) map.set(id, null);
    for (const row of rows) {
      map.set(
        row.recruiterId,
        row._avg.rating != null ? Math.round(row._avg.rating * 10) / 10 : null,
      );
    }
    return map;
  }
}
