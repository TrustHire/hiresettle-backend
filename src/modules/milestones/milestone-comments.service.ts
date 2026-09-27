import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { cursorPage } from '../../common/pagination/cursor-pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { EngagementPartyFields, PartyUser, requirePartyRole } from './engagement-party';

const PARTICIPANTS = ['COMPANY', 'RECRUITER', 'ARBITER'] as const;
const PARTICIPANT_ONLY = 'Only the company, recruiter and arbiter on this engagement can access milestone comments';

/**
 * MilestoneCommentsService (#379)
 *
 * A discussion thread per milestone, restricted to the engagement's
 * participants. Every new comment notifies the other participants (in-app
 * and email, per their preferences) and appears in the engagement activity feed.
 */
@Injectable()
export class MilestoneCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(engagementId: string, milestoneIndex: number, user: PartyUser, body: string) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    requirePartyRole(engagement, user, [...PARTICIPANTS], PARTICIPANT_ONLY);

    const comment = await this.prisma.milestoneComment.create({
      data: { milestoneId: milestone.id, engagementId, authorId: user.id, body },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;
    const type = NotificationType.MILESTONE_COMMENT_ADDED;
    const title = `New comment on milestone ${milestoneIndex}`;
    const message =
      `${comment.author?.name ?? 'A participant'} commented on milestone ${milestoneIndex} ` +
      `of engagement ${engagementId}: "${preview}"`;
    const data = { engagementId, milestoneIndex, commentId: comment.id };

    for (const recipient of MilestoneCommentsService.recipients(engagement, user)) {
      if (recipient.id) await this.notifications.notifyUserById(recipient.id, type, title, message, data);
      else await this.notifications.notifyUser(recipient.address, type, title, message, data);
    }

    return comment;
  }

  async list(
    engagementId: string,
    milestoneIndex: number,
    user: PartyUser,
    { cursor, limit = 20 }: { cursor?: string; limit?: number } = {},
  ) {
    const { milestone, engagement } = await this.load(engagementId, milestoneIndex);
    requirePartyRole(engagement, user, [...PARTICIPANTS], PARTICIPANT_ONLY);

    const take = Math.min(Math.max(limit, 1), 100);
    const items = await this.prisma.milestoneComment.findMany({
      where: { milestoneId: milestone.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    return cursorPage(items, take);
  }

  /** Participants other than the author, identified by user id when known, else by wallet. */
  static recipients(engagement: EngagementPartyFields, author: PartyUser) {
    const parties = [
      { id: engagement.companyId ?? null, address: engagement.companyAddress },
      { id: engagement.recruiterId ?? null, address: engagement.recruiterAddress },
      { id: engagement.arbiterId ?? null, address: engagement.arbiterAddress },
    ];
    const seen = new Set<string>();
    return parties.filter((p) => {
      const isAuthor = (!!p.id && p.id === author.id) || (!!author.stellarAddress && p.address === author.stellarAddress);
      const key = p.id ?? p.address;
      if (isAuthor || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async load(engagementId: string, milestoneIndex: number) {
    const found = await this.prisma.milestone.findUnique({
      where: { engagementId_milestoneIndex: { engagementId, milestoneIndex } },
      include: { engagement: true },
    });
    if (!found) throw new NotFoundException(`Milestone ${milestoneIndex} not found on engagement ${engagementId}`);
    const { engagement, ...milestone } = found;
    return { milestone, engagement };
  }
}
