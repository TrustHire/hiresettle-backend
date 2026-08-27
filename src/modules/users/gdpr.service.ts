import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /** DELETE /users/me — anonymise PII, retain stellarAddress for on-chain integrity */
  async requestErasure(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { name: null, email: null, deletedAt: new Date() },
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
