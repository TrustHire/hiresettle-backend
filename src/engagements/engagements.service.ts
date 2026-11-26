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

export type CandidateStage =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED';

export const CANDIDATE_STAGES: CandidateStage[] = [
  'SUBMITTED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
];

export interface CandidateSubmission {
  id: string;
  engagementId: string;
  recruiterId: string;
  name: string;
  resumeKey: string;
  stage: CandidateStage;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmitCandidateInput {
  recruiterId: string;
  name: string;
  resumeKey: string;
  notes?: string;
}

export interface ChangeCandidateStageInput {
  companyId: string;
  stage: CandidateStage;
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
  private readonly candidateSubmissions = new Map<string, CandidateSubmission>();

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

  /**
   * Submits a candidate to an engagement. Only the engagement's recruiter may
   * submit candidates; the submission starts in the SUBMITTED stage.
   */
  async submitCandidate(
    engagementId: string,
    input: SubmitCandidateInput,
  ): Promise<CandidateSubmission> {
    const engagement = await this.findOne(engagementId);

    if ((engagement as any).recruiterId !== input.recruiterId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ENGAGEMENT_CANDIDATE_FORBIDDEN',
        message: 'Only the engagement recruiter can submit candidates',
      });
    }

    const now = new Date();
    const submission: CandidateSubmission = {
      id: this.generateId(),
      engagementId,
      recruiterId: input.recruiterId,
      name: input.name,
      resumeKey: input.resumeKey,
      stage: 'SUBMITTED',
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.candidateSubmissions.set(submission.id, submission);

    await this.recordCandidateAudit(engagementId, 'candidate.submitted', {
      candidateId: submission.id,
      recruiterId: submission.recruiterId,
      name: submission.name,
      stage: submission.stage,
    });

    return submission;
  }

  /**
   * Moves a candidate through the pipeline. Only the engagement's company may
   * change stages. Every change is audited and the recruiter is notified.
   * Marking a candidate HIRED pre-fills the placed-candidate details.
   */
  async changeCandidateStage(
    engagementId: string,
    candidateId: string,
    input: ChangeCandidateStageInput,
  ): Promise<CandidateSubmission> {
    const engagement = await this.findOne(engagementId);

    if ((engagement as any).companyId !== input.companyId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ENGAGEMENT_CANDIDATE_FORBIDDEN',
        message: 'Only the engagement company can change candidate stages',
      });
    }

    if (!CANDIDATE_STAGES.includes(input.stage)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'ENGAGEMENT_CANDIDATE_INVALID_STAGE',
        message: `Invalid candidate stage: ${input.stage}`,
      });
    }

    const submission = this.candidateSubmissions.get(candidateId);
    if (!submission || submission.engagementId !== engagementId) {
      throw new NotFoundException(`Candidate ${candidateId} not found`);
    }

    const previousStage = submission.stage;
    submission.stage = input.stage;
    submission.updatedAt = new Date();
    this.candidateSubmissions.set(submission.id, submission);

    await this.recordCandidateAudit(engagementId, 'candidate.stage_changed', {
      candidateId: submission.id,
      from: previousStage,
      to: submission.stage,
    });

    await this.notifyRecruiterOfStageChange(engagement, submission, previousStage);

    if (submission.stage === 'HIRED') {
      await this.prefillPlacedCandidate(engagement, submission);
    }

    return submission;
  }

  /**
   * Lists candidate submissions for an engagement. Only engagement parties
   * (the recruiter or the company) may read submissions.
   */
  async findCandidates(
    engagementId: string,
    requesterId: string,
  ): Promise<CandidateSubmission[]> {
    const engagement = await this.findOne(engagementId);

    const isParty =
      (engagement as any).recruiterId === requesterId ||
      (engagement as any).companyId === requesterId;

    if (!isParty) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ENGAGEMENT_CANDIDATE_FORBIDDEN',
        message: 'Only engagement parties can read candidate submissions',
      });
    }

    return Array.from(this.candidateSubmissions.values()).filter(
      (submission) => submission.engagementId === engagementId,
    );
  }

  private async recordCandidateAudit(
    engagementId: string,
    action: string,
    data: Record<string, any>,
  ): Promise<void> {
    const engagement = await this.engagementRepository.findOne({
      where: { id: engagementId },
    });
    if (!engagement) {
      return;
    }
    const auditLog: any[] = ((engagement as any).auditLog as any[]) ?? [];
    auditLog.push({
      id: this.generateId(),
      action,
      timestamp: new Date().toISOString(),
      data,
    });
    (engagement as any).auditLog = auditLog;
    await this.engagementRepository.save(engagement);
  }

  private async notifyRecruiterOfStageChange(
    engagement: Engagement,
    submission: CandidateSubmission,
    previousStage: CandidateStage,
  ): Promise<void> {
    const notifications: any[] =
      ((engagement as any).notifications as any[]) ?? [];
    notifications.push({
      id: this.generateId(),
      recipientId: submission.recruiterId,
      type: 'candidate.stage_changed',
      timestamp: new Date().toISOString(),
      data: {
        engagementId: engagement.id,
        candidateId: submission.id,
        candidateName: submission.name,
        from: previousStage,
        to: submission.stage,
      },
    });
    (engagement as any).notifications = notifications;
    await this.engagementRepository.save(engagement);
  }

  private async prefillPlacedCandidate(
    engagement: Engagement,
    submission: CandidateSubmission,
  ): Promise<void> {
    (engagement as any).placedCandidate = {
      candidateId: submission.id,
      name: submission.name,
      resumeKey: submission.resumeKey,
      recruiterId: submission.recruiterId,
    };
    await this.engagementRepository.save(engagement);
  }

  private generateId(): string {
    return (
      (globalThis as any).crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
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
      throw new NotFoundException(`Engagement ${id} not found`);
    }
    return engagement;
  }

  private computeInviteExpiry(): Date {
    return new Date(Date.now() + 7 * DAY_MS);
  }

  private async computeRiskScore(
    engagement: Engagement,
  ): Promise<{ score: number; flagged: boolean }> {
    const score = 0;
    return { score, flagged: score >= 70 };
  }
}
