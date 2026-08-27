import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * DELETE /users/me — re-authenticate, block on active engagements,
   * anonymise PII, mark account closed, queue deletion for admin review.
   */
  async requestErasure(userId: string, dto: DeleteAccountDto): Promise<{ message: string }> {
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
        data: {
          name: null,
          email: null,
          company: null,
          avatarUrl: null,
          webhookUrl: null,
          webhookSecret: null,
          passwordHash: null,
          totpSecret: null,
          totpEnabled: false,
          deactivatedAt: now,
          deletedAt: now,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
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
