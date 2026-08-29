import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserDataExportDto } from './dto/user-data-export.dto';

@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
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
        slackWebhookUrl: true,
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

    if (user.deletedAt) {
      throw new ConflictException('Account deletion has already been requested');
    }

    await this.requireReauthentication(user, dto);
    await this.assertNoActiveEngagements(user);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { name: null, email: null, googleId: null, deletedAt: new Date() },
      }),
      this.prisma.dataDeletionRequest.create({
        data: { userId },
      }),
    ]);

    return {
      message:
        'Account closed and PII anonymised. A deletion request has been queued for admin review.',
    };
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

  private async requireReauthentication(
    user: {
      id: string;
      passwordHash: string | null;
      stellarAddress: string | null;
    },
    dto: DeleteAccountDto,
  ) {
    if (dto.password) {
      if (!user.passwordHash) {
        throw new BadRequestException('Account does not support password re-authentication');
      }
      const ok = await this.authService.checkPassword(dto.password, user.passwordHash);
      if (!ok) {
        throw new UnauthorizedException('Invalid password');
      }
      return;
    }

    if (dto.signature) {
      if (!user.stellarAddress) {
        throw new BadRequestException('Account has no Stellar address for signature re-authentication');
      }
      if (!dto.nonce) {
        throw new BadRequestException('nonce is required when providing a signature');
      }
      const ok = this.authService.verifyWalletSignature(
        user.stellarAddress,
        dto.nonce,
        dto.signature,
      );
      if (!ok) {
        throw new UnauthorizedException('Invalid signature or expired challenge nonce');
      }
      return;
    }

    throw new UnauthorizedException(
      'Re-authentication required: provide password or a signed challenge nonce',
    );
  }

  private async assertNoActiveEngagements(user: {
    id: string;
    stellarAddress: string | null;
  }) {
    const activeStatuses: EngagementStatus[] = [
      EngagementStatus.ACTIVE,
      EngagementStatus.REPLACEMENT_REQUESTED,
    ];

    const orFilters: Array<Record<string, unknown>> = [
      { companyId: user.id },
      { recruiterId: user.id },
      { arbiterId: user.id },
    ];
    if (user.stellarAddress) {
      orFilters.push(
        { companyAddress: user.stellarAddress },
        { recruiterAddress: user.stellarAddress },
        { arbiterAddress: user.stellarAddress },
      );
    }

    const activeCount = await this.prisma.engagement.count({
      where: {
        status: { in: activeStatuses },
        OR: orFilters,
      },
    });

    if (activeCount > 0) {
      throw new ConflictException(
        `Cannot delete account while ${activeCount} active engagement(s) are in progress. Complete or cancel them first.`,
      );
    }
  }
}
