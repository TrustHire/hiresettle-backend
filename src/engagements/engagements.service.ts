import { Injectable, NotFoundException } from '@nestjs/common';
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
 * Configurable risk-scoring rules. Values are sourced from SystemConfig
 * (see `getRiskConfig`) so admins can tune thresholds without a deploy.
 */
export interface RiskScoringConfig {
  /** Score at or above which an engagement is flagged for admin review. */
  flagThreshold: number;
  /** Window (ms) used to detect rapid creation/cancellation velocity. */
  velocityWindowMs: number;
  /** Number of same-party engagements within the window that triggers a hit. */
  velocityCountThreshold: number;
  /** Points added per velocity hit. */
  velocityWeight: number;
  /** Account age (days) below which the account is considered new. */
  newAccountDays: number;
  /** Points added for a new account. */
  newAccountWeight: number;
  /** Points added when KYC is not verified. */
  kycUnverifiedWeight: number;
  /** Points added per prior dispute. */
  priorDisputeWeight: number;
}

export const DEFAULT_RISK_CONFIG: RiskScoringConfig = {
  flagThreshold: 60,
  velocityWindowMs: 24 * 60 * 60 * 1000,
  velocityCountThreshold: 3,
  velocityWeight: 30,
  newAccountDays: 7,
  newAccountWeight: 20,
  kycUnverifiedWeight: 25,
  priorDisputeWeight: 15,
};

@Injectable()
export class EngagementsService {
  constructor(
    @InjectRepository(Engagement)
    private readonly engagementRepository: Repository<Engagement>,
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
  ) {}

  async create(createEngagementDto: CreateEngagementDto): Promise<Engagement> {
    const engagement = this.engagementRepository.create({
      ...createEngagementDto,
      status: EngagementStatus.DRAFT,
    });

    const { score, flagged } = await this.computeRiskScore(engagement);
    (engagement as any).riskScore = score;
    (engagement as any).riskFlagged = flagged;

    return this.engagementRepository.save(engagement);
  }

  /**
   * Resolve risk-scoring rules from SystemConfig, falling back to defaults.
   * SystemConfig is read defensively so this works even when the config
   * repository is not wired into this service.
   */
  private async getRiskConfig(): Promise<RiskScoringConfig> {
    const configRepo = (this.engagementRepository.manager as any)?.getRepository?.(
      'SystemConfig',
    );
    if (!configRepo) {
      return DEFAULT_RISK_CONFIG;
    }
    try {
      const rows: Array<{ key: string; value: any }> = await configRepo.find({
        where: { key: 'riskScoring' },
      });
      const stored = rows?.[0]?.value;
      if (stored && typeof stored === 'object') {
        return { ...DEFAULT_RISK_CONFIG, ...stored };
      }
    } catch {
      // Fall through to defaults if SystemConfig is unavailable.
    }
    return DEFAULT_RISK_CONFIG;
  }

  /**
   * Compute a risk score (0-100) from velocity, account age, KYC status and
   * prior disputes. Returns the score and whether it exceeds the flag
   * threshold. Flagging never blocks the engagement; admins decide.
   */
  async computeRiskScore(
    engagement: Partial<Engagement>,
  ): Promise<{ score: number; flagged: boolean }> {
    const config = await this.getRiskConfig();
    let score = 0;

    // Velocity: rapid creation/cancellation between the same parties.
    const companyId = (engagement as any).companyId;
    const recruiterId = (engagement as any).recruiterId;
    if (companyId && recruiterId) {
      const since = new Date(Date.now() - config.velocityWindowMs);
      const recent = await this.engagementRepository
        .createQueryBuilder('engagement')
        .where('engagement.companyId = :companyId', { companyId })
        .andWhere('engagement.recruiterId = :recruiterId', { recruiterId })
        .andWhere('engagement.createdAt >= :since', { since })
        .getCount();
      if (recent >= config.velocityCountThreshold) {
        score += config.velocityWeight;
      }
    }

    // Account age: newer accounts carry more risk.
    const accountCreatedAt = (engagement as any).accountCreatedAt;
    if (accountCreatedAt) {
      const ageDays =
        (Date.now() - new Date(accountCreatedAt).getTime()) /
        (24 * 60 * 60 * 1000);
      if (ageDays < config.newAccountDays) {
        score += config.newAccountWeight;
      }
    }

    // KYC status: unverified parties add risk.
    const kycStatus = (engagement as any).kycStatus;
    if (kycStatus && kycStatus !== 'verified') {
      score += config.kycUnverifiedWeight;
    }

    // Prior disputes between the parties.
    const priorDisputes = Number((engagement as any).priorDisputes ?? 0);
    if (priorDisputes > 0) {
      score += priorDisputes * config.priorDisputeWeight;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, flagged: score >= config.flagThreshold };
  }

  /**
   * List engagements flagged for admin review. Flagged engagements remain
   * fully operational unless an admin explicitly blocks them.
   */
  async findFlagged(): Promise<Engagement[]> {
    return this.engagementRepository.find({
      where: { riskFlagged: true } as any,
      relations: ['milestones'],
      order: { riskScore: 'DESC' } as any,
    });
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

  async getActivity(
    id: string,
    options: { cursor?: string; limit?: number; isCompany?: boolean } = {},
  ): Promise<ActivityFeed> {
    const engagement = await this.findOne(id);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

    const items: ActivityItem[] = [];

    // Audit log entries
    const auditLog = (engagement as any).auditLog ?? [];
    for (const entry of auditLog) {
      items.push({
        id: `audit:${entry.id}`,
        type: 'audit',
        timestamp: new Date(entry.createdAt ?? entry.timestamp).toISOString(),
        visibility: entry.visibility ?? 'company',
        data: entry,
      });
    }

    // Milestone history
    for (const milestone of engagement.milestones ?? []) {
      items.push({
        id: `milestone:${milestone.id}`,
        type: 'milestone',
        timestamp: new Date(
          (milestone as any).updatedAt ??
            (milestone as any).createdAt ??
            Date.now(),
        ).toISOString(),
        visibility: 'company',
        data: milestone,
      });
    }

    // Notes
    const notes = (engagement as any).notes ?? [];
    for (const note of notes) {
      items.push({
        id: `note:${note.id}`,
        type: 'note',
        timestamp: new Date(note.createdAt ?? note.timestamp).toISOString(),
        visibility: note.visibility ?? 'internal',
        data: note,
      });
    }

    // Chain events
    const chainEvents = (engagement as any).chainEvents ?? [];
    for (const event of chainEvents) {
      items.push({
        id: `chain:${event.id}`,
        type: 'chain',
        timestamp: new Date(event.createdAt ?? event.timestamp).toISOString(),
        visibility: 'company',
        data: event,
      });
    }

    // Respect visibility: internal notes only for company
    const visible = options.isCompany
      ? items
      : items.filter((item) => item.visibility !== 'internal');

    // Sort by time descending across all merged sources
    visible.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // Cursor pagination
    let startIndex = 0;
    if (options.cursor) {
      const decoded = Buffer.from(options.cursor, 'base64').toString('utf8');
      const cursorIndex = visible.findIndex((item) => item.id === decoded);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = visible.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < visible.length;
    const nextCursor = hasMore
      ? Buffer.from(page[page.length - 1].id, 'utf8').toString('base64')
      : null;

    return { items: page, nextCursor };
  }
}
