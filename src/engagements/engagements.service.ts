import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Engagement, EngagementStatus } from './entities/engagement.entity';
import { Milestone } from './entities/milestone.entity';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { UpdateEngagementDto } from './dto/update-engagement.dto';

export type ActivityType =
  | 'audit'
  | 'milestone'
  | 'note'
  | 'chain';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: string;
  visibility: 'internal' | 'company';
  data: Record<string, any>;
}

export interface ActivityFeed {
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface FindAllOptions {
  q?: string;
  status?: EngagementStatus;
  limit?: number;
  offset?: number;
}

/**
 * Company-level approval settings. When `approvalRequired` is true, any
 * engagement whose amount meets or exceeds `approvalThreshold` must be
 * approved by an approver before it can be funded.
 */
export interface CompanyApprovalSettings {
  approvalRequired: boolean;
  approvalThreshold: number;
}

export interface ApproverContext {
  userId: string;
  role: string;
}

const APPROVER_ROLES = ['approver', 'admin', 'owner'];

/**
 * A single payout split rule for an engagement. `basisPoints` is expressed
 * out of 10000 (100%). All splits for an engagement must sum to 10000.
 */
export interface PayoutSplit {
  address: string;
  basisPoints: number;
}

/** Total basis points representing 100%. */
export const TOTAL_BASIS_POINTS = 10000;

/** Stellar ed25519 public keys are 56 chars, starting with 'G'. */
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string;
  createdAt: string;
  visibility: 'internal' | 'company';
  [key: string]: any;
}

@Injectable()
export class EngagementsService {
  constructor(
    @InjectRepository(Engagement)
    private readonly engagementRepository: Repository<Engagement>,
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
  ) {}

  async create(createEngagementDto: CreateEngagementDto): Promise<Engagement> {
    const settings = await this.getCompanyApprovalSettings(
      (createEngagementDto as any).companyId,
    );

    const status = this.requiresApproval(
      settings,
      createEngagementDto.amount,
    )
      ? EngagementStatus.PENDING_APPROVAL
      : EngagementStatus.DRAFT;

    const engagement = this.engagementRepository.create({
      ...createEngagementDto,
      status,
    });
    return this.engagementRepository.save(engagement);
  }

  async findAll(options: FindAllOptions = {}): Promise<Engagement[]> {
    const { q, status, limit, offset } = options;

    // No search term: preserve existing basic filtering/pagination behavior.
    if (!q || !q.trim()) {
      return this.engagementRepository.find({
        where: status ? { status } : undefined,
        relations: ['milestones'],
        ...(limit !== undefined ? { take: limit } : {}),
        ...(offset !== undefined ? { skip: offset } : {}),
      });
    }

    // Ranked full-text search over the generated tsvector column
    // (title + description + tags), backed by a GIN index.
    const queryBuilder = this.engagementRepository
      .createQueryBuilder('engagement')
      .leftJoinAndSelect('engagement.milestones', 'milestone')
      .where(
        'engagement.search_vector @@ plainto_tsquery(\'english\', :q)',
        { q: q.trim() },
      )
      .orderBy(
        'ts_rank(engagement.search_vector, plainto_tsquery(\'english\', :q))',
        'DESC',
      )
      .setParameter('q', q.trim());

    if (status) {
      queryBuilder.andWhere('engagement.status = :status', { status });
    }

    if (limit !== undefined) {
      queryBuilder.take(limit);
    }

    if (offset !== undefined) {
      queryBuilder.skip(offset);
    }

    return queryBuilder.getMany();
  }

  async findOne(id: string): Promise<Engagement> {
    const engagement = await this.engagementRepository.findOne({
      where: { id },
      relations: ['milestones'],
    });
    if (!engagement) {
      throw new NotFoundException(`Engagement with id ${id} not found`);
    }
    return engagement;
  }

  async update(
    id: string,
    updateEngagementDto: UpdateEngagementDto,
  ): Promise<Engagement> {
    const engagement = await this.findOne(id);
    Object.assign(engagement, updateEngagementDto);
    return this.engagementRepository.save(engagement);
  }

  async remove(id: string): Promise<void> {
    const engagement = await this.findOne(id);
    await this.engagementRepository.remove(engagement);
  }

  async duplicate(id: string): Promise<Engagement> {
    const source = await this.findOne(id);

    const duplicate = this.engagementRepository.create({
      title: source.title,
      amount: source.amount,
      token: source.token,
      status: EngagementStatus.DRAFT,
      sourceEngagementId: source.id,
    });

    const saved = await this.engagementRepository.save(duplicate);

    if (source.milestones?.length) {
      const milestones = source.milestones.map((milestone) =>
        this.milestoneRepository.create({
          title: milestone.title,
          description: milestone.description,
          amount: milestone.amount,
          engagementId: saved.id,
        }),
      );
      saved.milestones = await this.milestoneRepository.save(milestones);
    }

    return saved;
  }

  /**
   * Approve a pending engagement. Only company members with an approver
   * role may approve; the action is recorded in the audit log.
   */
  async approve(
    id: string,
    approver: ApproverContext,
  ): Promise<Engagement> {
    this.assertApprover(approver);
    const engagement = await this.findOne(id);

    if (engagement.status !== EngagementStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        `Engagement ${id} is not pending approval`,
      );
    }

    engagement.status = EngagementStatus.DRAFT;
    this.recordAudit(engagement, 'engagement.approved', approver.userId);
    return this.engagementRepository.save(engagement);
  }

  /**
   * Reject a pending engagement. Only company members with an approver
   * role may reject; the action is recorded in the audit log.
   */
  async reject(
    id: string,
    approver: ApproverContext,
  ): Promise<Engagement> {
    this.assertApprover(approver);
    const engagement = await this.findOne(id);

    if (engagement.status !== EngagementStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        `Engagement ${id} is not pending approval`,
      );
    }

    engagement.status = EngagementStatus.REJECTED;
    this.recordAudit(engagement, 'engagement.rejected', approver.userId);
    return this.engagementRepository.save(engagement);
  }

  /**
   * Guard used before funding. Throws when the engagement still requires
   * internal approval, blocking any escrow funding.
   */
  async assertFundable(id: string): Promise<Engagement> {
    const engagement = await this.findOne(id);
    if (engagement.status === EngagementStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        `Engagement ${id} is pending internal approval and cannot be funded`,
      );
    }
    if (engagement.status === EngagementStatus.REJECTED) {
      throw new ForbiddenException(
        `Engagement ${id} was rejected and cannot be funded`,
      );
    }
    return engagement;
  }

  /**
   * Replace the payout split rules for an engagement. Splits may only be
   * changed while the engagement is unfunded (draft / pending approval).
   * Every address must be a valid Stellar account and the basis points must
   * sum to exactly 10000.
   */
  async setPayoutSplits(
    id: string,
    splits: PayoutSplit[],
  ): Promise<Engagement> {
    const engagement = await this.findOne(id);

    if (!this.isUnfunded(engagement)) {
      throw new ForbiddenException(
        `Payout splits for engagement ${id} can only change while unfunded`,
      );
    }

    this.validatePayoutSplits(splits);

    (engagement as any).payoutSplits = splits.map((split) => ({
      address: split.address,
      basisPoints: split.basisPoints,
    }));

    return this.engagementRepository.save(engagement);
  }

  /**
   * Build the multi-operation payment for a milestone release, distributing
   * the amount across the engagement's payout splits. Rounding remainders
   * are assigned to the primary (first) recruiter split.
   */
  buildReleasePayments(
    engagement: Engagement,
    amount: number,
  ): Array<{ destination: string; amount: string }> {
    const splits: PayoutSplit[] = (engagement as any).payoutSplits ?? [];
    if (!splits.length) {
      return [];
    }

    this.validatePayoutSplits(splits);

    const total = Number(amount);
    const payments = splits.map((split) => ({
      destination: split.address,
      amount: this.toStroops(total, split.basisPoints),
    }));

    // Assign any rounding remainder to the primary recruiter (first split).
    const distributed = payments.reduce(
      (sum, payment) => sum + BigInt(payment.amount),
      0n,
    );
    const expected = BigInt(Math.round(total * 1e7));
    const remainder = expected - distributed;
    if (remainder !== 0n) {
      payments[0].amount = (BigInt(payments[0].amount) + remainder).toString();
    }

    return payments;
  }

  private isUnfunded(engagement: Engagement): boolean {
    return (
      engagement.status === EngagementStatus.DRAFT ||
      engagement.status === EngagementStatus.PENDING_APPROVAL
    );
  }

  private validatePayoutSplits(splits: PayoutSplit[]): void {
    if (!Array.isArray(splits) || splits.length === 0) {
      throw new BadRequestException('At least one payout split is required');
    }

    let totalBasisPoints = 0;
    for (const split of splits) {
      if (!split || typeof split.address !== 'string') {
        throw new BadRequestException('Each payout split needs an address');
      }
      if (!STELLAR_ADDRESS_REGEX.test(split.address)) {
        throw new BadRequestException(
          `Invalid Stellar address in payout split: ${split.address}`,
        );
      }
      if (
        !Number.isInteger(split.basisPoints) ||
        split.basisPoints <= 0 ||
        split.basisPoints > TOTAL_BASIS_POINTS
      ) {
        throw new BadRequestException(
          `Invalid basis points for ${split.address}: ${split.basisPoints}`,
        );
      }
      totalBasisPoints += split.basisPoints;
    }

    if (totalBasisPoints !== TOTAL_BASIS_POINTS) {
      throw new BadRequestException(
        `Payout splits must sum to ${TOTAL_BASIS_POINTS} bps, got ${totalBasisPoints}`,
      );
    }
  }

  private toStroops(amount: number, basisPoints: number): string {
    const stroops = BigInt(Math.round(amount * 1e7));
    return ((stroops * BigInt(basisPoints)) / BigInt(TOTAL_BASIS_POINTS))
      .toString();
  }

  private assertApprover(approver: ApproverContext): void {
    if (!approver || !APPROVER_ROLES.includes(approver.role)) {
      throw new ForbiddenException(
        'Only company members with an approver role may approve or reject engagements',
      );
    }
  }

  private requiresApproval(
    settings: CompanyApprovalSettings,
    amount: number,
  ): boolean {
    if (!settings.approvalRequired) {
      return false;
    }
    return Number(amount) >= Number(settings.approvalThreshold ?? 0);
  }

  private recordAudit(
    engagement: Engagement,
    action: string,
    actorId: string,
  ): void {
    const auditLog: AuditLogEntry[] = (engagement as any).auditLog ?? [];
    auditLog.push({
      id: `${action}:${actorId}:${Date.now()}`,
      action,
      actorId,
      createdAt: new Date().toISOString(),
      visibility: 'com

/* … truncated 3348 chars — edit only what you need near the top … */
