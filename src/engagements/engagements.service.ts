import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
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

/** Default invite lifetime in days, overridable via INVITE_EXPIRY_DAYS. */
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;
/** Reminder window before expiry, overridable via INVITE_REMINDER_HOURS. */
export const DEFAULT_INVITE_REMINDER_HOURS = 24;

/**
 * Notification events that must always be delivered, even when the recipient
 * has muted the engagement (disputes, funds released, etc.).
 */
export const CRITICAL_NOTIFICATION_EVENTS: ReadonlySet<string> = new Set([
  'dispute_opened',
  'dispute_resolved',
  'funds_released',
]);

/**
 * Per-user, per-engagement mute state. Keyed by `${userId}:${engagementId}` so
 * muting is scoped to a single user rather than the engagement as a whole.
 */
const mutedEngagements = new Map<string, Set<string>>();

function muteKey(userId: string, engagementId: string): string {
  return `${userId}:${engagementId}`;
}

function inviteExpiryDays(): number {
  const parsed = Number(process.env.INVITE_EXPIRY_DAYS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_INVITE_EXPIRY_DAYS;
}

function inviteReminderHours(): number {
  const parsed = Number(process.env.INVITE_REMINDER_HOURS);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_INVITE_REMINDER_HOURS;
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
    const engagement = this.engagementRepository.create({
      ...createEngagementDto,
      status: EngagementStatus.DRAFT,
      inviteExpiresAt: this.computeInviteExpiry(),
    });
    return this.engagementRepository.save(engagement);
  }

  private computeInviteExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + inviteExpiryDays() * 24 * 60 * 60 * 1000);
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
   * Mute notifications for a single user on a single engagement.
   */
  async mute(id: string, userId: string): Promise<{ muted: boolean }> {
    await this.findOne(id);
    const key = muteKey(userId, id);
    const set = mutedEngagements.get(key) ?? new Set<string>();
    set.add(id);
    mutedEngagements.set(key, set);
    return { muted: true };
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

  private isInviteExpired(engagement: Engagement): boolean {
    const expiresAt = (engagement as any).inviteExpiresAt;
    return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
  }

  /**
   * Cron entry point: expire stale pending invites and notify the company.
   * Intended to be invoked by a scheduler guarded by the Redis cron lock.
   */
  async expireStaleInvites(): Promise<{ expired: number }> {
    const now = new Date();
    const stale = await this.engagementRepository.find({
      where: {
        status: EngagementStatus.DRAFT,
        inviteExpiresAt: LessThan(now),
      },
    });

    for (const engagement of stale) {
      engagement.status = EngagementStatus.EXPIRED;
      await this.engagementRepository.save(engagement);
      await this.notifyCompany(engagement, 'invite_expired');
    }

    return { expired: stale.length };
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
