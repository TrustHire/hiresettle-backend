import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserDataExportDto } from './dto/user-data-export.dto';

@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /** GET /users/me/export — GDPR right-to-access JSON bundle scoped to the requester */
  async exportUserData(userId: string): Promise<UserDataExportDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const addressOr: Array<Record<string, string>> = [];
    if (user.stellarAddress) {
      addressOr.push(
        { companyAddress: user.stellarAddress },
        { recruiterAddress: user.stellarAddress },
        { arbiterAddress: user.stellarAddress },
      );
    }

    const [engagements, notifications] = await Promise.all([
      this.prisma.engagement.findMany({
        where: {
          OR: [
            { companyId: userId },
            { recruiterId: userId },
            { arbiterId: userId },
            { clientId: userId },
            { freelancerId: userId },
            ...addressOr,
          ],
        },
        include: {
          milestones: {
            select: {
              id: true,
              kind: true,
              status: true,
              amount: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          data: true,
          read: true,
          createdAt: true,
        },
      }),
    ]);

    const { id: _id, createdAt, updatedAt, ...profile } = user;

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        ...profile,
      },
      engagements: engagements.map((e) => ({
        ...e,
        totalAmount: e.totalAmount.toString(),
        releasedAmount: e.releasedAmount.toString(),
        escrowBalance: e.escrowBalance?.toString() ?? null,
        milestones: e.milestones.map((m) => ({
          ...m,
          amount: m.amount?.toString() ?? null,
        })),
      })),
      notifications,
    };
  }

  /** DELETE /users/me — anonymise PII, retain stellarAddress for on-chain integrity */
  async requestErasure(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { name: null, email: null, googleId: null, deletedAt: new Date() },
      }),
      this.prisma.dataDeletionRequest.create({
        data: { userId },
      }),
    ]);

    return { message: 'Account anonymised. A deletion request has been queued for admin review.' };
  }

  /** GET /admin/data-deletion-requests */
  async listRequests(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.dataDeletionRequest.findMany({
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.dataDeletionRequest.count(),
    ]);
    return { data, meta: { total, page, limit } };
  }

  /** POST /admin/data-deletion-requests/:id/process */
  async processRequest(requestId: string, adminId: string) {
    const req = await this.prisma.dataDeletionRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Deletion request not found');

    return this.prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: { processedAt: new Date(), processedBy: adminId },
    });
  }
}
