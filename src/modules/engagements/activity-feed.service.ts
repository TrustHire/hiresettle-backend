import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { engagementPartyRole, PartyUser } from '../milestones/engagement-party';

export type ActivityType =
  | 'status_change'
  | 'note'
  | 'milestone_audit'
  | 'proof_version'
  | 'partial_release'
  | 'milestone_comment';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: Date;
  actorId: string | null;
  milestoneIndex: number | null;
  data: Record<string, any>;
}

interface Cursor {
  timestamp: Date;
  id: string;
}

/**
 * ActivityFeedService (#379)
 *
 * Merges everything that happened on an engagement — status changes, notes,
 * milestone audit entries, proof versions, partial releases and milestone
 * comments — into one newest-first timeline with keyset pagination.
 */
@Injectable()
export class ActivityFeedService {
  constructor(private readonly prisma: PrismaService) {}

  static encodeCursor(item: Pick<ActivityItem, 'timestamp' | 'id'>): string {
    return Buffer.from(`${item.timestamp.toISOString()}|${item.id}`, 'utf8').toString('base64url');
  }

  static decodeCursor(cursor: string): Cursor {
    const [iso, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const timestamp = new Date(iso);
    if (!rest.length || Number.isNaN(timestamp.getTime())) throw new BadRequestException('Invalid cursor');
    return { timestamp, id: rest.join('|') };
  }

  /** Newest first; ties on timestamp broken by id so pagination is stable. */
  static compare(a: Pick<ActivityItem, 'timestamp' | 'id'>, b: Pick<ActivityItem, 'timestamp' | 'id'>): number {
    const diff = b.timestamp.getTime() - a.timestamp.getTime();
    return diff !== 0 ? diff : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  }

  async getActivity(engagementId: string, user: PartyUser, { cursor, limit = 20 }: { cursor?: string; limit?: number } = {}) {
    const engagement = await this.prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);
    if (user.role !== UserRole.ADMIN && !engagementPartyRole(engagement, user)) {
      throw new ForbiddenException('You are not a participant of this engagement');
    }

    const take = Math.min(Math.max(limit, 1), 100);
    const after = cursor ? ActivityFeedService.decodeCursor(cursor) : null;
    // Each source returns at most take+1 rows at or before the cursor time; the
    // merged, sorted list is then cut precisely after the cursor item.
    const createdAt = after ? { createdAt: { lte: after.timestamp } } : {};
    const submittedAt = after ? { submittedAt: { lte: after.timestamp } } : {};
    const byMilestone = { milestone: { engagementId } };
    const window = { take: take + 1 };

    const [statusChanges, notes, milestoneAudits, proofVersions, partialReleases, comments] = await Promise.all([
      this.prisma.engagementAuditLog.findMany({
        where: { engagementId, ...createdAt },
        orderBy: { createdAt: 'desc' },
        ...window,
      }),
      this.prisma.engagementNote.findMany({
        where: { engagementId, ...createdAt },
        orderBy: { createdAt: 'desc' },
        ...window,
      }),
      this.prisma.milestoneAuditLog.findMany({
        where: { ...byMilestone, ...createdAt },
        orderBy: { createdAt: 'desc' },
        include: { milestone: { select: { milestoneIndex: true } } },
        ...window,
      }),
      this.prisma.milestoneProofVersion.findMany({
        where: { ...byMilestone, ...submittedAt },
        orderBy: { submittedAt: 'desc' },
        include: { milestone: { select: { milestoneIndex: true } } },
        ...window,
      }),
      this.prisma.milestonePartialRelease.findMany({
        where: { engagementId, ...createdAt },
        orderBy: { createdAt: 'desc' },
        include: { milestone: { select: { milestoneIndex: true } } },
        ...window,
      }),
      this.prisma.milestoneComment.findMany({
        where: { engagementId, ...createdAt },
        orderBy: { createdAt: 'desc' },
        include: {
          milestone: { select: { milestoneIndex: true } },
          author: { select: { id: true, name: true, role: true } },
        },
        ...window,
      }),
    ]);

    const items: ActivityItem[] = [
      ...statusChanges.map((e) => ({
        id: `status_change:${e.id}`,
        type: 'status_change' as const,
        timestamp: e.createdAt,
        actorId: e.changedBy,
        milestoneIndex: null,
        data: { fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason },
      })),
      ...notes.map((n) => ({
        id: `note:${n.id}`,
        type: 'note' as const,
        timestamp: n.createdAt,
        actorId: n.authorId,
        milestoneIndex: null,
        data: { body: n.body },
      })),
      ...milestoneAudits.map((a) => ({
        id: `milestone_audit:${a.id}`,
        type: 'milestone_audit' as const,
        timestamp: a.createdAt,
        actorId: a.changedBy,
        milestoneIndex: a.milestone.milestoneIndex,
        data: { fromStatus: a.fromStatus, toStatus: a.toStatus, action: a.action, details: a.details },
      })),
      ...proofVersions.map((v) => ({
        id: `proof_version:${v.id}`,
        type: 'proof_version' as const,
        timestamp: v.submittedAt,
        actorId: v.submittedById,
        milestoneIndex: v.milestone.milestoneIndex,
        data: { versionNumber: v.versionNumber, status: v.status, rejectionReason: v.rejectionReason },
      })),
      ...partialReleases.map((r) => ({
        id: `partial_release:${r.id}`,
        type: 'partial_release' as const,
        timestamp: r.createdAt,
        actorId: r.proposedById,
        milestoneIndex: r.milestone.milestoneIndex,
        data: {
          status: r.status,
          releaseAmount: r.releaseAmount.toString(),
          remainderAmount: r.remainderAmount.toString(),
          remainderAction: r.remainderAction,
          txHash: r.txHash,
        },
      })),
      ...comments.map((c) => ({
        id: `milestone_comment:${c.id}`,
        type: 'milestone_comment' as const,
        timestamp: c.createdAt,
        actorId: c.authorId,
        milestoneIndex: c.milestone.milestoneIndex,
        data: { body: c.body, author: c.author },
      })),
    ];

    const sorted = items
      .filter((item) => !after || ActivityFeedService.compare(after, item) < 0)
      .sort(ActivityFeedService.compare);

    const page = sorted.slice(0, take);
    const nextCursor = sorted.length > take ? ActivityFeedService.encodeCursor(page[page.length - 1]) : null;
    return { items: page, nextCursor };
  }
}
