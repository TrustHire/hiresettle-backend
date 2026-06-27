import {
  Injectable, NotFoundException, ConflictException, BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { EngagementStatus, MilestoneKind, MilestoneStatus, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class EngagementsService {
  private readonly logger = new Logger(EngagementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------
  // CREATE — validates, checks balance, submits on-chain, persists
  // ----------------------------------------------------------

  async create(dto: CreateEngagementDto) {
    const existing = await this.prisma.engagement.findUnique({
      where: { id: dto.engagementId },
    });
    if (existing) {
      throw new ConflictException(`Engagement ${dto.engagementId} already exists`);
    }

    // 1. Check company has sufficient token balance
    const { sufficient, balance } = await this.stellar.checkTokenBalance(
      dto.companyAddress,
      dto.tokenAddress,
      BigInt(dto.totalAmount),
    );
    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient token balance. Required: ${dto.totalAmount} stroops, available: ${balance.toString()}`,
      );
    }

    // 2. Submit on-chain create_engagement transaction
    const retentionMilestones = dto.milestones.filter((m) => m.kind === 'RETENTION');
    const { txHash, ledger: createdLedger } = await this.stellar.submitCreateEngagement({
      engagementId: dto.engagementId,
      companyAddress: dto.companyAddress,
      recruiterAddress: dto.recruiterAddress,
      arbiterAddress: dto.arbiterAddress,
      tokenAddress: dto.tokenAddress,
      totalAmount: dto.totalAmount,
      milestones: dto.milestones.map((m, index) => ({
        name: m.name,
        paymentPercent: m.paymentPercent,
        kind: m.kind,
        retentionDays: m.kind === 'RETENTION'
          ? dto.retentionDays?.[retentionMilestones.indexOf(m)] ?? undefined
          : undefined,
      })),
    });

    const currentLedger = await this.stellar.getLatestLedger();

    // 3. Build milestone data with unlock estimates
    let retentionIdx = 0;
    const milestoneData = dto.milestones.map((m, index) => {
      const isRetention = m.kind === 'RETENTION';
      const retentionDays = isRetention ? (dto.retentionDays?.[retentionIdx++] ?? null) : null;
      const validAfterLedger = isRetention && retentionDays
        ? createdLedger + (retentionDays * 17_280)
        : null;
      const unlockEstimatedAt = validAfterLedger
        ? this.stellar.ledgerToDateTime(validAfterLedger, currentLedger)
        : null;

      return {
        milestoneIndex: index,
        name: m.name,
        kind: m.kind as MilestoneKind,
        paymentPercent: m.paymentPercent,
        retentionDays,
        validAfterLedger: validAfterLedger ?? null,
        unlockEstimatedAt,
        status: isRetention ? MilestoneStatus.LOCKED : MilestoneStatus.PENDING,
      };
    });

    // 4. Persist engagement + milestones + retention schedules atomically
    const engagement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.engagement.create({
        data: {
          id: dto.engagementId,
          companyAddress: dto.companyAddress,
          recruiterAddress: dto.recruiterAddress,
          arbiterAddress: dto.arbiterAddress,
          tokenAddress: dto.tokenAddress,
          totalAmount: BigInt(dto.totalAmount),
          jobTitle: dto.jobTitle,
          jobDescription: dto.jobDescription,
          salaryRange: dto.salaryRange,
          location: dto.location,
          txHash,
          createdLedger,
          milestones: { create: milestoneData },
        },
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
      });

      for (const m of created.milestones) {
        if (m.kind === MilestoneKind.RETENTION && m.unlockEstimatedAt && m.validAfterLedger) {
          await tx.retentionSchedule.create({
            data: {
              engagementId: created.id,
              milestoneIndex: m.milestoneIndex,
              validAfterLedger: m.validAfterLedger,
              unlockAt: m.unlockEstimatedAt,
              notifyAt: new Date(m.unlockEstimatedAt.getTime() - 3 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }

      return created;
    });

    this.logger.log(`Engagement created on-chain and persisted: ${engagement.id} (tx: ${txHash})`);
    return this.serialize(engagement);
  }

  // ----------------------------------------------------------
  // READ
  // ----------------------------------------------------------

  async findAll(filters: {
    companyAddress?: string;
    recruiterAddress?: string;
    status?: string;       // single value or comma-separated list
    search?: string;       // partial case-insensitive match on jobTitle
    createdFrom?: string;  // ISO date string
    createdTo?: string;    // ISO date string
    page?: number;
    limit?: number;
  }) {
    const { companyAddress, recruiterAddress, status, search, createdFrom, createdTo, page = 1, limit = 20 } = filters;

    const where: any = {};
    if (companyAddress) where.companyAddress = companyAddress;
    if (recruiterAddress) where.recruiterAddress = recruiterAddress;

    if (status) {
      const statuses = status.split(',').map((s) => s.trim()) as EngagementStatus[];
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }

    if (search) {
      where.jobTitle = { contains: search, mode: 'insensitive' };
    }

    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) where.createdAt.gte = new Date(createdFrom);
      if (createdTo) where.createdAt.lte = new Date(createdTo);
    }

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

    return {
      data: engagements.map(this.serialize),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { milestoneIndex: 'asc' } },
        events: { orderBy: { ledger: 'desc' }, take: 20 },
      },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${id} not found`);
    return this.serialize(engagement);
  }

  // ----------------------------------------------------------
  // SYNC FROM CHAIN
  // ----------------------------------------------------------

  /**
   * Re-read the engagement status from Stellar and update the DB.
   * Called by EventsService after relevant on-chain events, or manually.
   */
  async syncFromChain(engagementId: string) {
    try {
      const { nativeToScVal } = await import('@stellar/stellar-sdk');
      const onChain = await this.stellar.simulateContractCall('get_engagement', [
        nativeToScVal(engagementId, { type: 'string' }),
      ]);
      if (!onChain) return;

      const statusMap: Record<string, EngagementStatus> = {
        Active: EngagementStatus.ACTIVE,
        Completed: EngagementStatus.COMPLETED,
        Cancelled: EngagementStatus.CANCELLED,
        ReplacementRequested: EngagementStatus.REPLACEMENT_REQUESTED,
      };

      await this.prisma.engagement.update({
        where: { id: engagementId },
        data: {
          status: statusMap[onChain.status] ?? EngagementStatus.ACTIVE,
          releasedAmount: BigInt(onChain.released_amount ?? 0),
        },
      });

      this.logger.log(`Synced engagement ${engagementId} from chain`);
    } catch (error) {
      this.logger.error(`Failed to sync ${engagementId}`, error.message);
    }
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  async recuseArbiter(engagementId: string, userId: string, userRole: UserRole) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      include: { arbiter: true },
    });
    if (!engagement) throw new NotFoundException('Engagement not found');

    if (userRole !== UserRole.ARBITER || !engagement.arbiter || engagement.arbiter.id !== userId) {
      throw new ForbiddenException('Only the assigned arbiter can recuse themselves');
    }

    // Notify all admins
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, deactivatedAt: null },
    });

    for (const admin of admins) {
      await this.notificationsService.notifyUserById(
        admin.id,
        'ARBITER_RECUSAL_REQUESTED',
        'Arbiter Recusal Requested',
        `Arbiter ${engagement.arbiter?.name} has recused themselves from engagement ${engagementId}. Please reassign.`,
        { engagementId, arbiterId: userId },
      );
    }

    return { message: 'Recusal request sent successfully' };
  }

  private serialize(engagement: any) {
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

  // ----------------------------------------------------------
  // ADMIN OVERRIDES
  // ----------------------------------------------------------

  async updateEngagementStatusByAdmin(
    engagementId: string,
    newStatus: EngagementStatus,
    reason: string,
    adminId: string,
  ) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });

    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }

    const oldStatus = engagement.status;

    await this.prisma.$transaction(async (tx) => {
      await tx.engagement.update({
        where: { id: engagementId },
        data: { status: newStatus },
      });

      await tx.auditLog.create({
        data: {
          entityType: 'Engagement',
          entityId: engagementId,
          action: 'STATUS_OVERRIDE',
          oldValue: oldStatus,
          newValue: newStatus,
          reason,
          changedBy: adminId,
        },
      });

      // Notify all parties involved in the engagement
      const usersToNotify = [
        engagement.companyAddress,
        engagement.recruiterAddress,
        engagement.arbiterAddress,
      ];

      for (const address of usersToNotify) {
        await this.notifications.notifyUser(
          address,
          NotificationType.ENGAGEMENT_CANCELLED, // Using CANCELLED as a generic override notification type for now
          `Engagement ${engagementId} status updated by Admin`,
          `The status of engagement ${engagementId} has been manually changed from ${oldStatus} to ${newStatus} by an administrator. Reason: ${reason}`,
          { engagementId, oldStatus, newStatus, reason },
        );
      }
    });

    this.logger.log(
      `Admin ${adminId} updated engagement ${engagementId} status from ${oldStatus} to ${newStatus}. Reason: ${reason}`,
    );

    return this.findOne(engagementId);
  }
}
