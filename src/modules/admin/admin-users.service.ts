import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ListUsersDto } from './dto/list-users.dto';
import { Prisma, UserRole, MilestoneStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
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
    // Get arbiters with active disputes count
    const arbiters = await this.prisma.user.findMany({
      where: { role: UserRole.ARBITER },
      include: {
        arbiterEngagements: {
          include: {
            milestones: {
              where: { status: MilestoneStatus.DISPUTED },
            },
          },
        },
      },
    });

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

    const totalEngagements = await this.prisma.engagement.count();
    const totalDisputedMilestones = await this.prisma.milestone.count({
      where: { status: MilestoneStatus.DISPUTED },
    });

    return {
      totalEngagements,
      totalDisputedMilestones,
      arbiterWorkload,
    };
  }
}
