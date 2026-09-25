import { Injectable } from '@nestjs/common';
import { MilestoneStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type DisputeOutcome = 'refunded' | 'released_to_worker' | 'split';

interface DisputeRecord {
  milestoneId: string;
  openedAt: Date;
  resolvedAt: Date | null;
  outcome: DisputeOutcome | null;
  arbiterId: string | null;
}

/** Formats a duration in ms as hours (< 48h) or days. */
export function formatDuration(ms: number | null): { ms: number | null; formatted: string | null } {
  if (ms === null) return { ms: null, formatted: null };
  const hours = ms / 3_600_000;
  return {
    ms: Math.round(ms),
    formatted: hours < 48 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`,
  };
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Dispute statistics for admins (#384).
 *
 * A dispute is a milestone transition into DISPUTED (MilestoneAuditLog). It is
 * resolved on the next transition out of DISPUTED. The outcome is derived from
 * whether a refund exists (refunded), a partial payment was released (split), or
 * the milestone was paid out (released_to_worker).
 */
@Injectable()
export class AdminDisputeStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(startDate?: Date, endDate?: Date) {
    const createdAt: Record<string, Date> = {};
    if (startDate) createdAt.gte = startDate;
    if (endDate) createdAt.lte = endDate;

    const openLogs = await this.prisma.milestoneAuditLog.findMany({
      where: {
        toStatus: MilestoneStatus.DISPUTED,
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        milestone: {
          include: {
            engagement: { select: { arbiterId: true } },
            refunds: true,
          } as any,
        },
      },
    });

    const milestoneIds = [...new Set(openLogs.map((l) => l.milestoneId))];
    const closeLogs = milestoneIds.length
      ? await this.prisma.milestoneAuditLog.findMany({
          where: { milestoneId: { in: milestoneIds }, fromStatus: MilestoneStatus.DISPUTED },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const disputes: DisputeRecord[] = openLogs.map((open) => {
      const close = closeLogs.find(
        (c) => c.milestoneId === open.milestoneId && c.createdAt >= open.createdAt,
      );
      const m: any = open.milestone;
      let outcome: DisputeOutcome | null = null;
      if (close) {
        const refund = Array.isArray(m?.refunds) ? m.refunds[0] : m?.refunds;
        const released = m?.paymentReleased ? BigInt(m.paymentReleased) : 0n;
        const amount = m?.amount ? BigInt(m.amount) : 0n;
        if (refund && released > 0n) outcome = 'split';
        else if (refund) outcome = 'refunded';
        else if (amount > 0n && released > 0n && released < amount) outcome = 'split';
        else outcome = 'released_to_worker';
      }
      return {
        milestoneId: open.milestoneId,
        openedAt: open.createdAt,
        resolvedAt: close?.createdAt ?? null,
        outcome,
        arbiterId: m?.engagement?.arbiterId ?? null,
      };
    });

    const resolved = disputes.filter((d) => d.resolvedAt);
    const durations = resolved.map((d) => d.resolvedAt!.getTime() - d.openedAt.getTime());

    const outcomes: Record<DisputeOutcome, number> = { refunded: 0, released_to_worker: 0, split: 0 };
    for (const d of resolved) outcomes[d.outcome!]++;

    const arbiterMap = new Map<string, { assigned: number; resolved: number; durations: number[] }>();
    for (const d of disputes) {
      const key = d.arbiterId ?? 'unassigned';
      const entry = arbiterMap.get(key) ?? { assigned: 0, resolved: 0, durations: [] };
      entry.assigned++;
      if (d.resolvedAt) {
        entry.resolved++;
        entry.durations.push(d.resolvedAt.getTime() - d.openedAt.getTime());
      }
      arbiterMap.set(key, entry);
    }

    return {
      range: { startDate: startDate ?? null, endDate: endDate ?? null },
      summary: {
        total: disputes.length,
        open: disputes.length - resolved.length,
        resolved: resolved.length,
      },
      averageTimeToResolution: formatDuration(average(durations)),
      outcomes,
      arbiters: [...arbiterMap.entries()].map(([arbiterId, e]) => ({
        arbiterId: arbiterId === 'unassigned' ? null : arbiterId,
        assigned: e.assigned,
        resolved: e.resolved,
        averageResolutionTime: formatDuration(average(e.durations)),
      })),
    };
  }
}
