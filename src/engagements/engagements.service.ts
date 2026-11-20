import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
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

export interface ExportOptions {
  q?: string;
  status?: EngagementStatus;
  companyId: string;
}

export interface ExclusivityStatus {
  active: boolean;
  exclusiveUntil: Date | null;
}

const EXCLUSIVITY_NOTICE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const CSV_COLUMNS = [
  'id',
  'title',
  'status',
  'amount',
  'token',
  'createdAt',
  'updatedAt',
] as const;

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
    await this.assertNoActiveExclusivity(createEngagementDto);

    const engagement = this.engagementRepository.create({
      ...createEngagementDto,
      status: EngagementStatus.DRAFT,
    });
    return this.engagementRepository.save(engagement);
  }

  /**
   * Rejects a new engagement when another recruiter already holds an active
   * exclusivity window for the same company + job title.
   */
  private async assertNoActiveExclusivity(
    dto: CreateEngagementDto,
  ): Promise<void> {
    const companyId = (dto as any).companyId;
    const title = (dto as any).title;
    const recruiterId = (dto as any).recruiterId;

    if (!companyId || !title) {
      return;
    }

    const conflicting = await this.engagementRepository.findOne({
      where: {
        companyId,
        title,
        exclusiveUntil: MoreThan(new Date()),
        ...(recruiterId ? { recruiterId: Not(recruiterId) } : {}),
      } as any,
    });

    if (conflicting) {
      throw new ConflictException({
        statusCode: 409,
        error: 'ENGAGEMENT_EXCLUSIVITY_CONFLICT',
        message: `An exclusive engagement for "${title}" is active until ${new Date(
          conflicting.exclusiveUntil as Date,
        ).toISOString()}`,
      });
    }
  }

  /**
   * Exclusivity end date may only be shortened without recruiter consent.
   */
  private assertExclusivityChangeAllowed(
    current: Date | null | undefined,
    next: Date | null | undefined,
    recruiterConsent: boolean,
  ): void {
    if (!current || !next || recruiterConsent) {
      return;
    }
    if (new Date(next).getTime() > new Date(current).getTime()) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ENGAGEMENT_EXCLUSIVITY_EXTENSION_FORBIDDEN',
        message:
          'Exclusivity end date can only be shortened without recruiter consent',
      });
    }
  }

  getExclusivityStatus(engagement: Engagement): ExclusivityStatus {
    const exclusiveUntil = (engagement as any).exclusiveUntil ?? null;
    return {
      active: !!exclusiveUntil && new Date(exclusiveUntil).getTime() > Date.now(),
      exclusiveUntil,
    };
  }

  /**
   * Returns engagements whose exclusivity ends within the next 3 days so both
   * parties can be notified ahead of expiry.
   */
  async findExclusivityExpiringSoon(): Promise<Engagement[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + EXCLUSIVITY_NOTICE_DAYS * DAY_MS);
    return this.engagementRepository.find({
      where: {
        exclusiveUntil: MoreThan(now),
      } as any,
    }).then((rows) =>
      rows.filter((row) => {
        const until = (row as any).exclusiveUntil;
        return until && new Date(until).getTime() <= horizon.getTime();
      }),
    );
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
   * Streams a CSV export of the caller's company engagements, reusing the
   * same list filters (q, status) as findAll. Scoped strictly to companyId
   * so no cross-company rows can leak. Rows are streamed in batches to keep
   * memory bounded for large sets.
   */
  async *exportCsv(options: ExportOptions): AsyncGenerator<string> {
    const { q, status, companyId } = options;

    const queryBuilder = this.engagementRepository
      .createQueryBuilder('engagement')
      .where('engagement.companyId = :companyId', { companyId });

    if (q && q.trim()) {
      queryBuilder.andWhere(
        'engagement.search_vector @@ plainto_tsquery(\'english\', :q)',
        { q: q.trim() },
      );
    }

    if (status) {
      queryBuilder.andWhere('engagement.status = :status', { status });
    }

    queryBuilder.orderBy('engagement.createdAt', 'DESC');

    yield CSV_COLUMNS.join(',') + '\n';

    const batchSize = 500;
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await queryBuilder
        .clone()
        .skip(offset)
        .take(batchSize)
        .getMany();

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        yield (
          CSV_COLUMNS.map((column) =>
            escapeCsvValue((row as any)[column]),
          ).join(',') + '\n'
        );
      }

      if (rows.length < batchSize) {
        break;
      }

      offset += batchSize;
    }
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

    if ((updateEngagementDto as any).exclusiveUntil !== undefined) {
      this.assertExclusivityChangeAllowed(
        (engagement as any).exclusiveUntil,
        (updateEngagementDto as any).exclusiveUntil,
        !!(updateEngagementDto as any).recruiterConsent,
      );
    }

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

    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = items.findIndex((item) => item.id === options.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < items.length;

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }
}
