import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ListUsersDto } from './dto/list-users.dto';
import { Prisma } from '@prisma/client';

const USER_SELECT = {
  id: true,
  email: true,
  stellarAddress: true,
  name: true,
  company: true,
  role: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
