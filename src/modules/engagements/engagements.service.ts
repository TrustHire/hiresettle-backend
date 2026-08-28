import {
  Injectable, NotFoundException, ConflictException, BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { User, EngagementStatus, MilestoneKind, MilestoneStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { EngagementSummaryDto } from './dto/engagement-summary.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from './audit-log.service';
import { cursorPage } from '../../common/pagination/cursor-pagination';

const ENGAGEMENT_SORTABLE_FIELDS: Record<string, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  status: 'status',
  jobTitle: 'jobTitle',
  totalAmount: 'totalAmount',
};

@Injectable()
export class EngagementsService {
  private readonly logger = new Logger(EngagementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
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

    // Validate customFields keys against the company's allow-list
    if (dto.customFields && Object.keys(dto.customFields).length > 0) {
      const companyUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { allowedCustomFields: true },
      });
      const allowed = companyUser?.allowedCustomFields ?? [];
      const unknown = Object.keys(dto.customFields).filter((k) => !allowed.includes(k));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Unknown custom field key(s): ${unknown.join(', ')}. Configure allowed keys via PUT /users/me/custom-fields-config`,
        );
      }
    }

    // Load template if provided — pin to the specific version that is current as of
    // now, so this engagement keeps referencing that exact snapshot even if the
    // template is edited (and gains new versions) afterwards.
    let templateVersion: any = null;
    if (dto.templateId) {
      const template = await this.prisma.engagementTemplate.findUnique({
        where: { id: dto.templateId },
      });
      if (!template) throw new NotFoundException(`Template ${dto.templateId} not found`);
      if (template.companyId !== user.id) throw new ForbiddenException('Not authorized to use this template');

      templateVersion = await this.prisma.engagementTemplateVersion.findUnique({
        where: { templateId_version: { templateId: template.id, version: template.currentVersion } },
      });
    }

    // Merge template version and dto (dto overrides template)
    const mergedData = {
      ...dto,
      jobTitle: dto.jobTitle ?? templateVersion?.jobTitle,
      jobDescription: dto.jobDescription ?? templateVersion?.jobDescription,
      salaryRange: dto.salaryRange ?? templateVersion?.salaryRange,
      location: dto.location ?? templateVersion?.location,
      milestones: dto.milestones ?? templateVersion?.milestoneConfig?.milestones,
      retentionDays: dto.retentionDays ?? templateVersion?.milestoneConfig?.retentionDays,
    };

    // Validate required fields after merge
    if (!mergedData.jobTitle) throw new BadRequestException('jobTitle is required (either provide it or use a template)');
    if (!mergedData.milestones) throw new BadRequestException('milestones are required (either provide them or use a template)');

    // Validate milestone sum still (since we merged)
    const sum = mergedData.milestones.reduce((acc: number, m: any) => acc + (m.paymentPercent || 0), 0);
    if (sum !== 100) throw new BadRequestException('Milestone paymentPercent values must sum to exactly 100');

    // Build milestone data (no on-chain data yet — deferred until recruiter accepts)
    let retentionIdx = 0;
    const milestoneData = mergedData.milestones.map((m: any, index: number) => {
      const isRetention = m.kind === 'RETENTION';
      const retentionDays = isRetention ? (mergedData.retentionDays?.[retentionIdx++] ?? null) : null;

      return {
        milestoneIndex: index,
        name: m.name,
        kind: m.kind as MilestoneKind,
        paymentPercent: m.paymentPercent,
        retentionDays,
        status: isRetention ? MilestoneStatus.LOCKED : MilestoneStatus.PENDING,
      };
    });

    // Persist engagement as PENDING_ACCEPTANCE — on-chain submission happens on recruiter accept
    const engagement = await this.prisma.engagement.create({
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
        customFields: mergedData.customFields ?? undefined,
        status: EngagementStatus.PENDING_ACCEPTANCE,
        templateVersionId: templateVersion?.id,
        milestones: { create: milestoneData },
      },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
    });

    this.logger.log(`Engagement invite created (PENDING_ACCEPTANCE): ${engagement.id}`);

    await this.notifications.notifyUser(
      mergedData.recruiterAddress,
      NotificationType.ENGAGEMENT_CREATED,
      `New engagement invite: ${mergedData.jobTitle}`,
      `You have a new engagement invite for "${mergedData.jobTitle}". Please accept or decline.`,
      { engagementId: engagement.id },
    );

    return this.serialize(engagement);
  }

  // ----------------------------------------------------------
  // RECRUITER INVITE ACCEPT / DECLINE (#250)
  // ----------------------------------------------------------

  async listPendingInvites(
    recruiterStellarAddress: string,
    page = 1,
    limit = 20,
    cursor?: string,
  ) {
    const where = {
      recruiterAddress: recruiterStellarAddress,
      status: EngagementStatus.PENDING_ACCEPTANCE,
    };

    if (cursor) {
      const engagements = await this.prisma.engagement.findMany({
        where,
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        cursor: { id: cursor },
        skip: 1,
        take: limit + 1,
      });
      const pageResult = cursorPage(engagements, limit);
      return {
        data: pageResult.data.map(this.serialize),
        meta: { limit, nextCursor: pageResult.nextCursor },
      };
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

  async acceptInvite(engagementId: string, user: User) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
    });

    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);
    if (engagement.recruiterAddress !== user.stellarAddress) {
      throw new ForbiddenException('You are not the invited recruiter for this engagement');
    }
    if (engagement.status !== EngagementStatus.PENDING_ACCEPTANCE) {
      throw new ConflictException(`Engagement is not pending acceptance (current status: ${engagement.status})`);
    }

    // Check company balance and submit on-chain now that recruiter has accepted
    const { sufficient, balance } = await this.stellar.checkTokenBalance(
      engagement.companyAddress,
      engagement.tokenAddress,
      engagement.totalAmount,
    );
    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient company token balance. Required: ${engagement.totalAmount.toString()} stroops, available: ${balance.toString()}`,
      );
    }

    const retentionMilestones = engagement.milestones.filter((m) => m.kind === MilestoneKind.RETENTION);
    const { txHash, ledger: createdLedger } = await this.stellar.submitCreateEngagement({
      engagementId: engagement.id,
      companyAddress: engagement.companyAddress,
      recruiterAddress: engagement.recruiterAddress,
      arbiterAddress: engagement.arbiterAddress,
      tokenAddress: engagement.tokenAddress,
      totalAmount: engagement.totalAmount.toString(),
      milestones: engagement.milestones.map((m) => ({
        name: m.name,
        paymentPercent: m.paymentPercent,
        kind: m.kind,
        retentionDays: m.kind === MilestoneKind.RETENTION
          ? retentionMilestones.indexOf(m) >= 0 && m.retentionDays != null
            ? m.retentionDays
            : undefined
          : undefined,
      })),
    });

    const currentLedger = await this.stellar.getLatestLedger();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.engagement.update({
        where: { id: engagementId },
        data: { status: EngagementStatus.ACTIVE, txHash, createdLedger },
      });

      for (const m of engagement.milestones) {
        if (m.kind === MilestoneKind.RETENTION && m.retentionDays) {
          const validAfterLedger = createdLedger + m.retentionDays * 17_280;
          const unlockEstimatedAt = this.stellar.ledgerToDateTime(validAfterLedger, currentLedger);
          await tx.milestone.update({
            where: { id: m.id },
            data: { validAfterLedger, unlockEstimatedAt },
          });
          await tx.retentionSchedule.create({
            data: {
              engagementId,
              milestoneIndex: m.milestoneIndex,
              validAfterLedger,
              unlockAt: unlockEstimatedAt,
              notifyAt: new Date(unlockEstimatedAt.getTime() - 3 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }

      return tx.engagement.findUnique({
        where: { id: engagementId },
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
      });
    });

    this.logger.log(`Engagement ${engagementId} accepted by recruiter, on-chain tx: ${txHash}`);

    await Promise.allSettled([
      this.notifications.notifyUser(
        engagement.companyAddress,
        NotificationType.ENGAGEMENT_CREATED,
        `Engagement accepted: ${engagement.jobTitle}`,
        `The recruiter has accepted the engagement "${engagement.jobTitle}" (${engagementId}). On-chain funding is in progress.`,
        { engagementId, txHash },
      ),
    ]);

    return this.serialize(updated);
  }

  async declineInvite(engagementId: string, user: User) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });

    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);
    if (engagement.recruiterAddress !== user.stellarAddress) {
      throw new ForbiddenException('You are not the invited recruiter for this engagement');
    }
    if (engagement.status !== EngagementStatus.PENDING_ACCEPTANCE) {
      throw new ConflictException(`Engagement is not pending acceptance (current status: ${engagement.status})`);
    }

    const updated = await this.prisma.engagement.update({
      where: { id: engagementId },
      data: { status: EngagementStatus.CANCELLED },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
    });

    this.logger.log(`Engagement ${engagementId} declined by recruiter — cancelled without on-chain submission`);

    await this.notifications.notifyUser(
      engagement.companyAddress,
      NotificationType.ENGAGEMENT_CANCELLED,
      `Engagement declined: ${engagement.jobTitle}`,
      `The recruiter has declined the engagement invite for "${engagement.jobTitle}" (${engagementId}).`,
      { engagementId },
    );

    return this.serialize(updated);
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
    cursor?: string;
    sortBy?: string;       // one of ENGAGEMENT_SORTABLE_FIELDS
    sortOrder?: string;    // 'asc' | 'desc'
    includeArchived?: boolean;
  }) {
    const {
      companyAddress, recruiterAddress, status, search, createdFrom, createdTo,
      page = 1, limit = 20, sortBy, sortOrder, includeArchived,
    } = filters;

    const where: any = {};
    if (companyAddress) where.companyAddress = companyAddress;
    if (recruiterAddress) where.recruiterAddress = recruiterAddress;

    if (!includeArchived) {
      where.archivedAt = null;
    }

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

    let orderBy: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };
    if (sortBy !== undefined) {
      const field = ENGAGEMENT_SORTABLE_FIELDS[sortBy];
      if (!field) {
        throw new BadRequestException(
          `Invalid sortBy value '${sortBy}'. Allowed values: ${Object.keys(ENGAGEMENT_SORTABLE_FIELDS).join(', ')}`,
        );
      }
      if (sortOrder !== undefined && sortOrder !== 'asc' && sortOrder !== 'desc') {
        throw new BadRequestException(`Invalid sortOrder value '${sortOrder}'. Allowed values: asc, desc`);
      }
      orderBy = { [field]: sortOrder === 'asc' ? 'asc' : 'desc' };
    }

    if (cursor) {
      const engagements = await this.prisma.engagement.findMany({
        where,
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
        orderBy,
        cursor: { id: cursor },
        skip: 1,
        take: limit + 1,
      });
      const pageResult = cursorPage(engagements, limit);
      return {
        data: pageResult.data.map(this.serialize),
        meta: { limit, nextCursor: pageResult.nextCursor },
      };
    }

    const [engagements, total] = await this.prisma.$transaction([
      this.prisma.engagement.findMany({
        where,
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
        orderBy,
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

      if (milestone.status === MilestoneStatus.CONFIRMED || milestone.status === MilestoneStatus.RESOLVED) {
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
  // NOTES
  // ----------------------------------------------------------

  async createNote(engagementId: string, user: { id: string; stellarAddress?: string; role: string }, body: string) {
    const engagement = await this.prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);
    this.checkParticipant(engagement, user);

    return this.prisma.engagementNote.create({
      data: { engagementId, authorId: user.id, body },
    });
  }

  async findNotes(engagementId: string, user: { id: string; stellarAddress?: string; role: string }) {
    const engagement = await this.prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);
    this.checkParticipant(engagement, user);

    return this.prisma.engagementNote.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private checkParticipant(
    engagement: { companyAddress: string; recruiterAddress: string; arbiterAddress: string },
    user: { stellarAddress?: string; role: string },
  ): void {
    if (user.role === UserRole.ADMIN) return;
    const parties = [engagement.companyAddress, engagement.recruiterAddress, engagement.arbiterAddress];
    if (!user.stellarAddress || !parties.includes(user.stellarAddress)) {
      throw new ForbiddenException('You are not a participant of this engagement');
    }
  }

  // ----------------------------------------------------------
  // CANCEL
  // ----------------------------------------------------------

  async cancelEngagement(engagementId: string, requestingUser: User) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });

    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }

    if (engagement.companyAddress !== requestingUser.stellarAddress) {
      throw new ForbiddenException('Only the company party may cancel this engagement');
    }

    if (
      engagement.status === EngagementStatus.CANCELLED ||
      engagement.status === EngagementStatus.COMPLETED
    ) {
      throw new ConflictException(
        `Cannot cancel an engagement with status '${engagement.status}'`,
      );
    }

    const txHash = await this.stellar.cancelEngagement(engagementId);
    this.logger.log(`On-chain cancel submitted for ${engagementId} (tx: ${txHash})`);

    const updated = await this.prisma.$transaction(async (tx) => {
      return tx.engagement.update({
        where: { id: engagementId },
        data: { status: EngagementStatus.CANCELLED },
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
      });
    });

    const notifyTitle = `Engagement Cancelled – ${engagement.jobTitle}`;
    const notifyMessage =
      `The engagement "${engagement.jobTitle}" (${engagementId}) has been cancelled by the company. ` +
      `On-chain transaction: ${txHash}`;

    await Promise.allSettled([
      this.notifications.notifyUser(
        engagement.companyAddress,
        NotificationType.ENGAGEMENT_CANCELLED,
        notifyTitle,
        notifyMessage,
        { engagementId, txHash },
      ),
      this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.ENGAGEMENT_CANCELLED,
        notifyTitle,
        notifyMessage,
        { engagementId, txHash },
      ),
      this.notifications.notifyUser(
        engagement.arbiterAddress,
        NotificationType.ENGAGEMENT_CANCELLED,
        notifyTitle,
        notifyMessage,
        { engagementId, txHash },
      ),
    ]);

    this.logger.log(`Engagement ${engagementId} cancelled and all parties notified`);
    return this.serialize(updated);
  }

  // ----------------------------------------------------------
  // REQUEST REPLACEMENT
  // ----------------------------------------------------------

  async requestReplacement(
    engagementId: string,
    requestingUser: User,
    reason?: string,
  ) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });

    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }

    if (engagement.companyAddress !== requestingUser.stellarAddress) {
      throw new ForbiddenException(
        'Only the company party may request a candidate replacement',
      );
    }

    if (
      engagement.status === EngagementStatus.CANCELLED ||
      engagement.status === EngagementStatus.COMPLETED ||
      engagement.status === EngagementStatus.REPLACEMENT_REQUESTED
    ) {
      throw new ConflictException(
        `Cannot request replacement for an engagement with status '${engagement.status}'`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      return tx.engagement.update({
        where: { id: engagementId },
        data: { status: EngagementStatus.REPLACEMENT_REQUESTED },
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
      });
    });

    const notifyTitle = `Replacement Requested – ${engagement.jobTitle}`;
    const reasonSuffix = reason ? ` Reason: "${reason}"` : '';
    const notifyMessage =
      `The company has requested a candidate replacement for engagement ` +
      `"${engagement.jobTitle}" (${engagementId}).${reasonSuffix}`;

    await Promise.allSettled([
      this.notifications.notifyUser(
        engagement.companyAddress,
        NotificationType.REPLACEMENT_REQUESTED,
        notifyTitle,
        notifyMessage,
        { engagementId, reason: reason ?? null },
      ),
      this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.REPLACEMENT_REQUESTED,
        notifyTitle,
        notifyMessage,
        { engagementId, reason: reason ?? null },
      ),
      this.notifications.notifyUser(
        engagement.arbiterAddress,
        NotificationType.REPLACEMENT_REQUESTED,
        notifyTitle,
        notifyMessage,
        { engagementId, reason: reason ?? null },
      ),
    ]);

    this.logger.log(
      `Engagement ${engagementId} replacement requested and all parties notified`,
    );
    return this.serialize(updated);
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

      const engagement = await this.prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      if (!engagement) return;

      const releasedAmount = BigInt(onChain.released_amount ?? 0);
      const { balance: escrowBalance } = await this.stellar.getBalance(
        this.stellar.getContractId(),
        engagement.tokenAddress,
      );
      const expectedEscrowBalance = engagement.totalAmount - releasedAmount;
      const fundingShortfall = escrowBalance !== expectedEscrowBalance;

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
          releasedAmount,
          escrowBalance,
          fundingShortfall,
        },
      });

      if (fundingShortfall && !engagement.fundingShortfall) {
        const message =
          `Engagement ${engagementId} has a funding shortfall. ` +
          `Expected ${expectedEscrowBalance.toString()} stroops, ` +
          `but the escrow contains ${escrowBalance.toString()} stroops.`;
        await Promise.all([
          this.notifications.notifyUser(
            engagement.companyAddress,
            NotificationType.FUNDING_SHORTFALL_DETECTED,
            'Engagement funding shortfall detected',
            message,
            { engagementId, expectedEscrowBalance: expectedEscrowBalance.toString(), escrowBalance: escrowBalance.toString() },
          ),
          this.notifications.notifyUser(
            engagement.recruiterAddress,
            NotificationType.FUNDING_SHORTFALL_DETECTED,
            'Engagement funding shortfall detected',
            message,
            { engagementId, expectedEscrowBalance: expectedEscrowBalance.toString(), escrowBalance: escrowBalance.toString() },
          ),
        ]);
      }

      this.logger.log(`Synced engagement ${engagementId} from chain`);
    } catch (error) {
      this.logger.error(`Failed to sync ${engagementId}`, error.message);
    }
  }

  // ----------------------------------------------------------
  // STATUS MANAGEMENT
  // ----------------------------------------------------------

  async updateStatus(
    engagementId: string,
    newStatus: EngagementStatus,
    requestingUserId: string,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.engagement.findUniqueOrThrow({
        where: { id: engagementId },
        select: { status: true },
      });

      const updated = await tx.engagement.update({
        where: { id: engagementId },
        data: { status: newStatus },
      });

      await this.auditLog.record(tx, {
        engagementId,
        fromStatus: current.status,
        toStatus: newStatus,
        changedBy: requestingUserId,
        reason,
      });

      return updated;
    });
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
      await this.notifications.notifyUserById(
        admin.id,
        NotificationType.ARBITER_RECUSAL_REQUESTED,
        'Arbiter Recusal Requested',
        `Arbiter ${engagement.arbiter?.name} has recused themselves from engagement ${engagementId}. Please reassign.`,
        { engagementId, arbiterId: userId },
      );
    }

    return { message: 'Recusal request sent successfully' };
  }

  // ----------------------------------------------------------
  // ARCHIVE / RESTORE
  // ----------------------------------------------------------

  async archive(engagementId: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }
    if (engagement.archivedAt) {
      throw new ConflictException(`Engagement ${engagementId} is already archived`);
    }

    const updated = await this.prisma.engagement.update({
      where: { id: engagementId },
      data: { archivedAt: new Date() },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
    });

    this.logger.log(`Engagement ${engagementId} archived`);
    return this.serialize(updated);
  }

  async restore(engagementId: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }
    if (!engagement.archivedAt) {
      throw new ConflictException(`Engagement ${engagementId} is not archived`);
    }

    const updated = await this.prisma.engagement.update({
      where: { id: engagementId },
      data: { archivedAt: null },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
    });

    this.logger.log(`Engagement ${engagementId} restored`);
    return this.serialize(updated);
  }

  private serialize(engagement: any) {
    return {
      ...engagement,
      totalAmount: engagement.totalAmount?.toString(),
      releasedAmount: engagement.releasedAmount?.toString(),
      escrowBalance: engagement.escrowBalance?.toString() ?? null,
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

      await this.auditLog.record(tx, {
        engagementId,
        fromStatus: oldStatus,
        toStatus: newStatus,
        changedBy: adminId,
        reason,
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
