import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateProofSlaSettingsDto } from './dto/proof-sla-settings.dto';

const TRANSFER_TTL_DAYS = 7;

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Issue #377: proof review SLA ──────────────────────────────────────────

  async getProofSlaSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { proofSlaDays: true, proofSlaAction: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProofSlaSettings(userId: string, dto: UpdateProofSlaSettingsDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.proofSlaDays !== undefined ? { proofSlaDays: dto.proofSlaDays } : {}),
        ...(dto.proofSlaAction !== undefined ? { proofSlaAction: dto.proofSlaAction } : {}),
      },
      select: { proofSlaDays: true, proofSlaAction: true },
    });
  }

  // ── Issue #360 ────────────────────────────────────────────────────────────

  /**
   * Step 1 — Current owner initiates a transfer to an existing member.
   *
   * Business rules:
   *  - Only the OWNER can initiate (enforced by CompanyRoleGuard on the controller).
   *  - `newOwnerId` must already be a CompanyMember of this company.
   *  - At most one pending transfer per company at a time; the old one is cancelled first.
   */
  async initiateTransfer(currentOwnerId: string, newOwnerId: string) {
    if (currentOwnerId === newOwnerId) {
      throw new BadRequestException('You cannot transfer ownership to yourself');
    }

    // Resolve the company: for single-user owners there is no CompanyMember row,
    // so companyId = currentOwnerId (the owner's own User.id is the company anchor).
    const companyId = await this.resolveCompanyId(currentOwnerId);

    // Verify new owner is an existing member of this company
    const membership = await this.prisma.companyMember.findUnique({
      where: { companyId_memberId: { companyId, memberId: newOwnerId } },
    });

    if (!membership) {
      throw new BadRequestException(
        'The proposed new owner is not a member of your company. ' +
          'Invite them first via POST /team-invites.',
      );
    }

    // Cancel any existing pending transfer for this company
    await this.prisma.ownershipTransfer.updateMany({
      where: { companyId, acceptedAt: null, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });

    const expiresAt = new Date(Date.now() + TRANSFER_TTL_DAYS * 24 * 60 * 60 * 1000);

    const transfer = await this.prisma.ownershipTransfer.create({
      data: {
        id: randomBytes(16).toString('hex'),
        companyId,
        fromOwnerId: currentOwnerId,
        toMemberId: newOwnerId,
        expiresAt,
      },
    });

    this.logger.log(
      `Ownership transfer initiated: company=${companyId} from=${currentOwnerId} to=${newOwnerId}`,
    );

    return {
      transferId: transfer.id,
      newOwnerId,
      expiresAt: transfer.expiresAt,
      message:
        'Transfer initiated. The new owner must accept via POST /companies/transfer-ownership/accept.',
    };
  }

  /**
   * Step 2 — Proposed new owner accepts the pending transfer.
   *
   * Atomically:
   *  1. Mark the transfer as accepted.
   *  2. Upsert the old owner's CompanyMember row → MEMBER.
   *  3. Update the new owner's CompanyMember row → OWNER.
   *  4. Write an AuditLog entry.
   */
  async acceptTransfer(acceptingUserId: string) {
    // Find the pending transfer addressed to this user
    const transfer = await this.prisma.ownershipTransfer.findFirst({
      where: {
        toMemberId: acceptingUserId,
        acceptedAt: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!transfer) {
      throw new NotFoundException(
        'No pending ownership transfer found for your account',
      );
    }

    if (transfer.expiresAt < new Date()) {
      throw new BadRequestException(
        'This ownership transfer has expired. The current owner must initiate a new one.',
      );
    }

    const { companyId, fromOwnerId, toMemberId } = transfer;

    await this.prisma.$transaction(async (tx) => {
      // 1. Consume the transfer record
      await tx.ownershipTransfer.update({
        where: { id: transfer.id },
        data: { acceptedAt: new Date() },
      });

      // 2. Demote the old owner → MEMBER
      //    Use upsert: single-user companies have no CompanyMember row yet.
      await tx.companyMember.upsert({
        where: { companyId_memberId: { companyId, memberId: fromOwnerId } },
        update: { companyRole: CompanyRole.MEMBER },
        create: {
          companyId,
          memberId: fromOwnerId,
          companyRole: CompanyRole.MEMBER,
        },
      });

      // 3. Promote the new owner → OWNER
      await tx.companyMember.update({
        where: { companyId_memberId: { companyId, memberId: toMemberId } },
        data: { companyRole: CompanyRole.OWNER },
      });

      // 4. Audit log
      await tx.auditLog.create({
        data: {
          entityType: 'CompanyMember',
          entityId: companyId,
          action: 'OWNERSHIP_TRANSFER',
          oldValue: fromOwnerId,
          newValue: toMemberId,
          reason: 'Ownership transfer accepted by new owner',
          changedBy: acceptingUserId,
        },
      });
    });

    this.logger.log(
      `Ownership transfer accepted: company=${companyId} oldOwner=${fromOwnerId} newOwner=${toMemberId}`,
    );

    return {
      message: 'Ownership transfer complete. You are now the company owner.',
      companyId,
      previousOwnerId: fromOwnerId,
      newOwnerId: toMemberId,
    };
  }

  /**
   * Cancel a pending ownership transfer.
   * Only the current owner (who initiated it) can cancel.
   */
  async cancelTransfer(currentOwnerId: string) {
    const companyId = await this.resolveCompanyId(currentOwnerId);

    const transfer = await this.prisma.ownershipTransfer.findFirst({
      where: { companyId, fromOwnerId: currentOwnerId, acceptedAt: null, cancelledAt: null },
    });

    if (!transfer) {
      throw new NotFoundException('No pending ownership transfer to cancel');
    }

    await this.prisma.ownershipTransfer.update({
      where: { id: transfer.id },
      data: { cancelledAt: new Date() },
    });

    return { message: 'Ownership transfer cancelled.' };
  }

  /**
   * Get the current pending transfer for the owner's company.
   */
  async getPendingTransfer(currentOwnerId: string) {
    const companyId = await this.resolveCompanyId(currentOwnerId);

    const transfer = await this.prisma.ownershipTransfer.findFirst({
      where: { companyId, acceptedAt: null, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!transfer) {
      return { pending: false };
    }

    return {
      pending: true,
      transferId: transfer.id,
      fromOwnerId: transfer.fromOwnerId,
      toMemberId: transfer.toMemberId,
      expiresAt: transfer.expiresAt,
      createdAt: transfer.createdAt,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve the logical company ID for a user.
   *
   * Design note: `CompanyMember.companyId` references the company *owner's* User.id.
   * For the original single-user owner there is no CompanyMember row; the owner IS the
   * company, so companyId == their own userId.
   *
   * For sub-users who were invited (and later promoted to owner), they have a
   * CompanyMember row where `memberId = userId` — we read `companyId` from there.
   */
  private async resolveCompanyId(userId: string): Promise<string> {
    // Check if this user is a member of another company (promoted from member)
    const membership = await this.prisma.companyMember.findFirst({
      where: { memberId: userId },
      select: { companyId: true },
    });

    if (membership) {
      return membership.companyId;
    }

    // Original owner: companyId == their own userId
    return userId;
  }
}

  // ----------------------------------------------------------
  // COMPANY ENGAGEMENT STATS (#374)
  // ----------------------------------------------------------

  async getEngagementStats(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const companyId = await this.resolveCompanyId(userId);

    // Build date filter
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);

    const whereClause: any = {
      companyId,
      ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
    };

    // Fetch all engagements matching the criteria
    const engagements = await this.prisma.engagement.findMany({
      where: whereClause,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        releasedAmount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Calculate stats
    const totalEngagements = engagements.length;
    const byStatus: Record<string, number> = {
      ACTIVE: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      PENDING_ACCEPTANCE: 0,
      REPLACEMENT_REQUESTED: 0,
      ACCOUNT_MERGED: 0,
    };

    let totalEscrowed = BigInt(0);
    let totalReleased = BigInt(0);
    let completedEngagements = 0;
    let totalCompletionDays = 0;

    for (const eng of engagements) {
      byStatus[eng.status] = (byStatus[eng.status] || 0) + 1;
      totalEscrowed += eng.totalAmount;
      totalReleased += eng.releasedAmount;

      if (eng.status === 'COMPLETED') {
        completedEngagements++;
        const daysToComplete = Math.floor(
          (eng.updatedAt.getTime() - eng.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        totalCompletionDays += daysToComplete;
      }
    }

    const avgTimeToPlacement = completedEngagements > 0 
      ? Math.round((totalCompletionDays / completedEngagements) * 10) / 10
      : 0;

    return {
      totalEngagements,
      byStatus,
      totalEscrowed: totalEscrowed.toString(),
      totalReleased: totalReleased.toString(),
      avgTimeToPlacement,
      ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
      ...(dateTo ? { dateTo: new Date(dateTo).toISOString() } : {}),
      generatedAt: new Date().toISOString(),
    };
  }
}
