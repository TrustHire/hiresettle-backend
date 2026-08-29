import {
  Injectable, NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async addFavorite(companyId: string, recruiterId: string) {
    const recruiter = await this.prisma.user.findUnique({
      where: { id: recruiterId },
      select: { id: true, role: true },
    });
    if (!recruiter) throw new NotFoundException('Recruiter not found');
    if (recruiter.role !== UserRole.RECRUITER) {
      throw new ForbiddenException('Target user is not a recruiter');
    }

    const existing = await this.prisma.favoriteRecruiter.findUnique({
      where: { companyId_recruiterId: { companyId, recruiterId } },
    });
    if (existing) throw new ConflictException('Recruiter is already in your favorites');

    return this.prisma.favoriteRecruiter.create({
      data: { companyId, recruiterId },
      include: {
        recruiter: { select: { id: true, name: true, stellarAddress: true, avatarUrl: true } },
      },
    });
  }

  async removeFavorite(companyId: string, recruiterId: string) {
    const existing = await this.prisma.favoriteRecruiter.findUnique({
      where: { companyId_recruiterId: { companyId, recruiterId } },
    });
    if (!existing) throw new NotFoundException('Recruiter is not in your favorites');

    await this.prisma.favoriteRecruiter.delete({
      where: { companyId_recruiterId: { companyId, recruiterId } },
    });

    return { message: 'Recruiter removed from favorites' };
  }

  async listFavorites(companyId: string, page = 1, limit = 20) {
    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.favoriteRecruiter.findMany({
        where: { companyId },
        include: {
          recruiter: { select: { id: true, name: true, stellarAddress: true, avatarUrl: true, kycStatus: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.favoriteRecruiter.count({ where: { companyId } }),
    ]);

    return {
      data: favorites,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
