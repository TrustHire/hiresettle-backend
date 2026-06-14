import {
  Injectable, NotFoundException, ConflictException, BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { EngagementSummaryDto } from './dto/engagement-summary.dto';
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

  async create(user: User, dto: CreateEngagementDto) {
    const existing = await this.prisma.engagement.findUnique({
      where: { id: dto.engagementId },
    });
    if (existing) {
      throw new ConflictException(`Engagement ${dto.engagementId} already exists`);
    }

    // Validate token is allowed
    if (!this.stellar.isTokenAllowed(dto.tokenAddress)) {
      throw new BadRequestException(`Token ${dto.tokenAddress} is not allowed`);
    }

    // Load template if provided
    let template: any = null;
    if (dto.templateId) {
      template = await this.prisma.engagementTemplate.findUnique({
        where: { id: dto.templateId },
      });
      if (!template) throw new NotFoundException(`Template ${dto.templateId} not found`);
      if (template.companyId !== user.id) throw new ForbiddenException('Not authorized to use this template');
    }

    // Merge template and dto (dto overrides template)
    const mergedData = {
      ...dto,
      jobTitle: dto.jobTitle ?? template?.jobTitle,
      jobDescription: dto.jobDescription ?? template?.jobDescription,
      salaryRange: dto.salaryRange ?? template?.salaryRange,
      location: dto.location ?? template?.location,
      milestones: dto.milestones ?? template?.milestoneConfig?.milestones,
      retentionDays: dto.retentionDays ?? template?.milestoneConfig?.retentionDays,
    };

    // Validate required fields after merge
    if (!mergedData.jobTitle) throw new BadRequestException('jobTitle is required (either provide it or use a template)');
    if (!mergedData.milestones) throw new BadRequestException('milestones are required (either provide them or use a template)');

    // Validate milestone sum still (since we merged)
    const sum = mergedData.milestones.reduce((acc: number, m: any) => acc + (m.paymentPercent || 0), 0);
    if (sum !== 100) throw new BadRequestException('Milestone paymentPercent values must sum to exactly 100');

    // 1. Check company has sufficient token balance
    const { sufficient, balance } = await this.stellar.checkTokenBalance(
      mergedData.companyAddress,
      mergedData.tokenAddress,
      BigInt(mergedData.totalAmount),
    );
    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient token balance. Required: ${mergedData.totalAmount} stroops, available: ${balance.toString()}`,
      );
    }

    // 2. Submit on-chain create_engagement transaction
    const retentionMilestones = mergedData.milestones.filter((m: any) => m.kind === 'RETENTION');
    const { txHash, ledger: createdLedger } = await this.stellar.submitCreateEngagement({
      engagementId: mergedData.engagementId,
      companyAddress: mergedData.companyAddress,
      recruiterAddress: mergedData.recruiterAddress,
      arbiterAddress: mergedData.arbiterAddress,
      tokenAddress: mergedData.tokenAddress,
      totalAmount: mergedData.totalAmount,
      milestones: mergedData.milestones.map((m: any, index: number) => ({
        name: m.name,
        paymentPercent: m.paymentPercent,
        kind: m.kind,
        retentionDays: m.kind === 'RETENTION'
          ? mergedData.retentionDays?.[retentionMilestones.indexOf(m)] ?? undefined
          : undefined,
      })),
    });

    const currentLedger = await this.stellar.getLatestLedger();

    // 3. Build milestone data with unlock estimates
    let retentionIdx = 0;
    const milestoneData = mergedData.milestones.map((m: any, index: number) => {
      const isRetention = m.kind === 'RETENTION';
      const retentionDays = isRetention ? (mergedData.retentionDays?.[retentionIdx++] ?? null) : null;
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
          id: mergedData.engagementId,
          companyAddress: mergedData.companyAddress,
          recruiterAddress: mergedData.recruiterAddress,
          arbiterAddress: mergedData.arbiterAddress,
          tokenAddress: mergedData.tokenAddress,
          totalAmount: BigInt(mergedData.totalAmount),
          jobTitle: mergedData.jobTitle,
          jobDescription: mergedData.jobDescription,
          salaryRange: mergedData.salaryRange,
          location: mergedData.location,
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

  /**
   * Retrieves the full engagement record including milestones and events.
   * If `userId` is provided, enforces that only parties to the engagement may view it.
   */
  async findOne(id: string, userId?: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { milestoneIndex: 'asc' } },
        events: { orderBy: { ledger: 'desc' }, take: 20 },
      },
    });

    if (!engagement) throw new NotFoundException(`Engagement ${id} not found`);

    if (userId && engagement.clientId && engagement.freelancerId) {
      if (engagement.clientId !== userId && engagement.freelancerId !== userId) {
        throw new ForbiddenException('You do not have access to this engagement');
      }
    }

    return this.serializeAmounts(engagement);
  }

  /**
   * Calculates and retrieves the aggregated summary for an engagement.
   */
  async getSummary(id: string, userId: string): Promise<EngagementSummaryDto> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id },
      include: { milestones: true },
    });

    if (!engagement) {
      throw new NotFoundException('Engagement not found');
    }

    if (engagement.clientId !== userId && engagement.freelancerId !== userId) {
      throw new ForbiddenException('You do not have access to this engagement');
    }

    let totalAmount = BigInt(0);
    let releasedAmount = BigInt(0);
    let milestonesCompleted = 0;

    for (const milestone of engagement.milestones) {
      const amount = typeof milestone.amount === 'bigint' ? milestone.amount : BigInt(milestone.amount as any);
      totalAmount += amount;

      if (milestone.status === 'COMPLETED' || milestone.status === 'RELEASED') {
        releasedAmount += amount;
        milestonesCompleted++;
      }
    }

    const lockedAmount = totalAmount - releasedAmount;

    return {
      totalAmount: totalAmount.toString(),
      releasedAmount: releasedAmount.toString(),
      lockedAmount: lockedAmount.toString(),
      milestonesTotal: engagement.milestones.length,
      milestonesCompleted,
    };
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

  /**
   * Helper utility to deeply convert BigInts to strings within an object.
   */
  private serializeAmounts(obj: any): any {
    return JSON.parse(
      JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );
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
