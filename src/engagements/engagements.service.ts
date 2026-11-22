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
      inviteExpiresAt: this.computeInviteExpiry(),
    });

    const { score, flagged } = await this.computeRiskScore(engagement);
    (engagement as any).riskScore = score;
    (engagement as any).riskFlagged = flagged;

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

  /**
   * Engagement detail for a specific user, including their per-user mute
   * state for this engagement.
   */
  async findOneForUser(
    id: string,
    userId: string,
  ): Promise<Engagement & { muted: boolean }> {
    const engagement = await this.findOne(id);
    return Object.assign(engagement, { muted: this.isMuted(userId, id) });
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
      inviteExpiresAt: this.computeInviteExpiry(),
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
   * Build the canonical agreement terms for an engagement. The terms are
   * derived from the persisted engagement so the hash always reflects the
   * current state of the record.
   */
  async buildAgreementTerms(id: string): Promise<AgreementTerms> {
    const engagement = await this.findOne(id);
    return {
      engagementId: engagement.id,
      parties: {
        companyId: (engagement as any).companyId ?? '',
        recruiterId: (engagement as any).recruiterId ?? '',
      },
      fee: {
        amount: String(engagement.amount ?? '0'),
        token: engagement.token ?? '',
      },
      milestones: (engagement.milestones ?? []).map((m) => ({
        title: m.title,
        amount: String(m.amount ?? '0'),
      })),
      retentionDays: Number((engagement as any).retentionDays ?? 0),
    };
  }

  /**
   * Record both parties' signatures over the canonical terms hash. The hash is
   * attached as the memo of the funding transaction so it is anchored on-chain.
   */
  async signAgreement(
    id: string,
    signatures: AgreementSignature[],
  ): Promise<AgreementRecord> {
    const terms = await this.buildAgreementTerms(id);
    const hash = hashTerms(terms);

    const parties = new Set(signatures.map((s) => s.party));
    if (!parties.has('company') || !parties.has('recruiter')) {
      throw new BadRequestException(
        'Both company and recruiter must sign the agreement',
      );
    }

    const engagement = await this.findOne(id);
    (engagement as any).agreementHash = hash;
    (engagement as any).agreementSignatures = signatures;
    (engagement as any).agreementMemo = hash;
    await this.engagementRepository.save(engagement);

    return { terms, hash, signatures, memo: hash };
  }

  /**
   * Return the agreement terms, hash and signatures. The hash is recomputed
   * from the current terms so that editing terms after signing invalidates
   * the stored signatures.
   */
  async getAgreement(id: string): Promise<AgreementRecord> {
    const engagement = await this.findOne(id);
    const terms = await this.buildAgreementTerms(id);
    const hash = hashTerms(terms);
    const signatures: AgreementSignature[] =
      (engagement as any).agreementSignatures ?? [];
    const memo = (engagement as any).agreementMemo ?? hash;

    return { terms, hash, signatures, memo };
  }

  async getActivity(
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

  /**
   * Unmute notifications for a single user on a single engagement.
   */
  async unmute(id: string, userId: string): Promise<{ muted: boolean }> {
    await this.findOne(id);
    mutedEngagements.delete(muteKey(userId, id));
    return { muted: false };
  }

  /**
   * Whether the given user has muted notifications for the engagement.
   */
  isMuted(userId: string, engagementId: string): boolean {
    return mutedEngagements.has(muteKey(userId, engagementId));
  }

  /**
   * Decide whether a notification should be delivered to a user for an
   * engagement. Critical events always deliver; non-critical events are
   * suppressed when the user has muted the engagement.
   */
  shouldDeliverNotification(
    userId: string,
    engagementId: string,
    event: string,
  ): boolean {
    if (CRITICAL_NOTIFICATION_EVENTS.has(event)) {
      return true;
    }
    return !this.isMuted(userId, engagementId);
  }

  /**
   * Accept an invite. Rejects invites whose expiry has passed so stale
   * pending invites can no longer be accepted.
   */
  async acceptInvite(id: string): Promise<Engagement> {
    const engagement = await this.findOne(id);
    if (this.isInviteExpired(engagement)) {
      throw new BadRequestException(
        `Invite for engagement ${id} has expired`,
      );
    }
    engagement.status = EngagementStatus.ACTIVE;
    return this.engagementRepository.save(engagement);
  }

  /**
   * Re-send an expired invite: reset the expiry window and re-issue it.
   */
  async resendInvite(id: string): Promise<Engagement> {
    const engagement = await this.findOne(id);
    if (!this.isInviteExpired(engagement)) {
      throw new BadRequestException(
        `Invite for engagement ${id} has not expired`,
      );
    }
    engagement.inviteExpiresAt = this.computeInviteExpiry();
    engagement.inviteReminderSentAt = null;
    engagement.status = EngagementStatus.DRAFT;
    return this.engagementRepository.save(engagement);
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

  /**
   * Cron entry point: remind recruiters 24h before their invite expires.
   */
  async sendInviteReminders(): Promise<{ reminded: number }> {
    const now = Date.now();
    const windowEnd = new Date(
      now + inviteReminderHours() * 60 * 60 * 1000,
    );
    const due = await this.engagementRepository.find({
      where: {
        status: EngagementStatus.DRAFT,
        inviteExpiresAt: LessThan(windowEnd),
      },
    });

    let reminded = 0;
    for (const engagement of due) {
      const expiresAt = (engagement as any).inviteExpiresAt;
      if (!expiresAt || new Date(expiresAt).getTime() <= now) {
        continue;
      }
      if ((engagement as any).inviteReminderSentAt) {
        continue;
      }
      engagement.inviteReminderSentAt = new Date();
      await this.engagementRepository.save(engagement);
      await this.notifyCompany(engagement, 'invite_exp

/* … truncated 3328 chars — edit only what you need near the top … */
