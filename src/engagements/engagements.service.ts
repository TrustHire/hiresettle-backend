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

/**
 * Filters for the public recruiter-facing listings feed. All filters are
 * optional and combine with AND semantics.
 */
export interface ListingFilters {
  specialization?: string;
  minFee?: number;
  maxFee?: number;
  location?: string;
  limit?: number;
  offset?: number;
}

/**
 * Public projection of an engagement. Sensitive fields (internal notes,
 * budget details, payout splits, audit log) are intentionally omitted.
 */
export interface PublicListing {
  id: string;
  title: string;
  description?: string;
  specialization?: string;
  location?: string;
  fee?: number;
  token?: string;
  createdAt: string;
}

export interface PaginatedListings {
  items: PublicListing[];
  total: number;
  limit: number;
  offset: number;
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

  /**
   * Public recruiter-facing listings feed. Only PUBLIC engagements are
   * returned, and each item is projected through `toPublicListing` so that
   * internal notes and budget details never leak. Results are paginated.
   */
  async findListings(
    filters: ListingFilters = {},
  ): Promise<PaginatedListings> {
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const queryBuilder = this.engagementRepository
      .createQueryBuilder('engagement')
      .where('engagement.visibility = :visibility', {
        visibility: 'PUBLIC',
      });

    if (filters.specialization) {
      queryBuilder.andWhere('engagement.specialization = :specialization', {
        specialization: filters.specialization,
      });
    }

    if (filters.location) {
      queryBuilder.andWhere('engagement.location = :location', {
        location: filters.location,
      });
    }

    if (filters.minFee !== undefined) {
      queryBuilder.andWhere('engagement.amount >= :minFee', {
        minFee: filters.minFee,
      });
    }

    if (filters.maxFee !== undefined) {
      queryBuilder.andWhere('engagement.amount <= :maxFee', {
        maxFee: filters.maxFee,
      });
    }

    queryBuilder
      .orderBy('engagement.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    const [engagements, total] = await queryBuilder.getManyAndCount();

    return {
      items: engagements.map((engagement) =>
        this.toPublicListing(engagement),
      ),
      total,
      limit,
      offset,
    };
  }

  /**
   * Publish an engagement to the public listings feed. Only companies that
   * have been verified (`verifiedAt` set) may publish.
   */
  async publishListing(
    id: string,
    company: { verifiedAt?: Date | null },
  ): Promise<Engagement> {
    if (!company?.verifiedAt) {
      throw new ForbiddenException(
        'Only verified companies can publish listings',
      );
    }

    const engagement = await this.findOne(id);
    engagement.visibility = 'PUBLIC';
    return this.engagementRepository.save(engagement);
  }

  /**
   * Admin-only: unpublish a listing, removing it from the public feed.
   */
  async unpublishListing(id: string): Promise<Engagement> {
    const engagement = await this.findOne(id);
    engagement.visibility = 'PRIVATE';
    return this.engagementRepository.save(engagement);
  }

  /**
   * Strip sensitive fields (internal notes, budget details, payout splits)
   * from an engagement before exposing it publicly.
   */
  private toPublicListing(engagement: Engagement): PublicListing {
    return {
      id: engagement.id,
      title: engagement.title,
      description: engagement.description,
      specialization: (engagement as any).specialization,
      location: (engagement as any).location,
      fee: engagement.amount,
      token: engagement.token,
      createdAt: (engagement.createdAt as any)?.toISOString?.() ??
        (engagement.createdAt as any),
    };
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

    if (
      engagement.status !== EngagementStatus.DRAFT &&
      engagement.status !== EngagementStatus.PENDING_APPROVAL
    ) {
      throw new ForbiddenException(
        `Payout splits cannot be changed for engagement ${id} in status ${engagement.status}`,
      );
    }

    if (!Array.isArray(splits) || splits.length === 0) {
      throw new BadRequestException('At least one payout split is required');
    }

    let total = 0;
    for (const split of splits) {
      if (!STELLAR_ADDRESS_REGEX.test(split.address)) {
        throw new BadRequestException(
          `Invalid Stellar address: ${split.address}`,
        );
      }
      if (!Number.isInteger(split.basisPoints) || split.basisPoints <= 0) {
        throw new BadRequestException(
          `Invalid basis points for ${split.address}`,
        );
      }
      total += split.basisPoints;
    }

    if (total !== TOTAL_BASIS_POINTS) {
      throw new BadRequestException(
        `Payout splits must sum to ${TOTAL_BASIS_POINTS} basis points (got ${total})`,
      );
    }

    (engagement as any).payoutSplits = splits;
    return this.engagementRepository.save(engagement);
  }

  private assertApprover(approver: ApproverContext): void {
    if (!approver || !APPROVER_ROLES.includes(approver.role)) {
      throw new ForbiddenException(
        'Only approvers may approve or reject engagements',
      );
    }
  }

  private recordAudit(
    engagement: Engagement,
    action: string,
    actorId: string,
  ): void {
    const log: AuditLogEntry[] = (engagement as any).auditLog ?? [];
    log.push({
      id: `${engagement.id}-${Date.now()}`,
      action,
      actorId,
      createdAt: new Date().toISOString(),
      visibility: 'internal',
    });
    (engagement as any).auditLog = log;
  }

  private async getCompanyApprovalSettings(
    companyId?: string,
  ): Promise<CompanyApprovalSettings> {
    if (!companyId) {
      return { approvalRequired: false, approvalThreshold: 0 };
    }
    const company = await this.engagementRepository.manager
      .getRepository('Company')
      .findOne({ where: { id: companyId } });
    return {
      approvalRequired: Boolean((company as any)?.approvalRequired),
      approvalThreshold: Number((company as any)?.approvalThreshold ?? 0),
    };
  }

  private requiresApproval(
    settings: CompanyApprovalSettings,
    amount: number,
  ): boolean {
    return settings.approvalRequired && amount >= settings.approvalThreshold;
  }
}
