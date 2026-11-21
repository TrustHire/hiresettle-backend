import {
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
      visibility: 'company',
    });
    (engagement as any).auditLog = auditLog;
  }

  /**
   * Loads the company approval settings. Overridable so the persistence
   * layer can supply the real company record.
   */
  protected async getCompanyApprovalSettings(
    companyId?: string,
  ): Promise<CompanyApprovalSettings> {
    const company = companyId
      ? await (this.engagementRepository.manager as any)
          .getRepository('Company')
          .findOne({ where: { id: companyId } })
          .catch(() => null)
      : null;

    return {
      approvalRequired: Boolean(company?.approvalRequired),
      approvalThreshold: Number(company?.approvalThreshold ?? 0),
    };
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
