import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EngagementStatus, MilestoneStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CalendarEvent {
  uid: string;
  date: Date;
  summary: string;
  description: string;
}

/** Engagements whose milestones can still come due. */
const ACTIVE_ENGAGEMENT_STATUSES: EngagementStatus[] = [
  EngagementStatus.ACTIVE,
  EngagementStatus.PENDING_ACCEPTANCE,
  EngagementStatus.REPLACEMENT_REQUESTED,
];

/** Milestones that are already paid out or refunded have nothing left to be due. */
const SETTLED_MILESTONE_STATUSES: MilestoneStatus[] = [MilestoneStatus.CONFIRMED, MilestoneStatus.RESOLVED];

/**
 * CalendarService (#380)
 *
 * Serves an RFC 5545 iCalendar feed of upcoming milestone due dates for a user.
 * Calendar clients cannot send bearer tokens, so the feed is authenticated by
 * a long random token in the query string. Only its SHA-256 hash is stored;
 * regenerating replaces it and revoking clears it, invalidating old feed URLs.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async regenerateToken(userId: string) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.user.update({
      where: { id: userId },
      data: { calendarTokenHash: CalendarService.hashToken(token), calendarTokenCreatedAt: new Date() },
    });
    return { token, feedPath: `/users/me/calendar.ics?token=${token}` };
  }

  async revokeToken(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { calendarTokenHash: null, calendarTokenCreatedAt: null },
    });
    return { revoked: true };
  }

  /** Resolves the feed token to its user and renders their calendar. */
  async renderFeed(token: string | undefined, now: Date = new Date()): Promise<string> {
    if (!token) throw new UnauthorizedException('Calendar token required');
    const user = await this.prisma.user.findUnique({
      where: { calendarTokenHash: CalendarService.hashToken(token) },
      select: { id: true, stellarAddress: true, deactivatedAt: true, deletedAt: true },
    });
    if (!user || user.deactivatedAt || user.deletedAt) throw new UnauthorizedException('Invalid calendar token');

    const events = await this.upcomingMilestoneEvents(user, now);
    return CalendarService.buildIcs(events, now);
  }

  async upcomingMilestoneEvents(user: { id: string; stellarAddress: string | null }, now: Date = new Date()) {
    const parties: Prisma.EngagementWhereInput[] = [
      { companyId: user.id },
      { recruiterId: user.id },
      { arbiterId: user.id },
    ];
    if (user.stellarAddress) {
      parties.push(
        { companyAddress: user.stellarAddress },
        { recruiterAddress: user.stellarAddress },
        { arbiterAddress: user.stellarAddress },
      );
    }

    const milestones = await this.prisma.milestone.findMany({
      where: {
        status: { notIn: SETTLED_MILESTONE_STATUSES },
        engagement: { status: { in: ACTIVE_ENGAGEMENT_STATUSES }, archivedAt: null, OR: parties },
        OR: [{ placementDueAt: { gte: now } }, { unlockEstimatedAt: { gte: now } }],
      },
      include: { engagement: { select: { id: true, jobTitle: true } } },
      orderBy: [{ engagementId: 'asc' }, { milestoneIndex: 'asc' }],
    });

    const events: CalendarEvent[] = [];
    for (const m of milestones) {
      const due = m.kind === 'PLACEMENT' ? m.placementDueAt : m.unlockEstimatedAt;
      if (!due || due < now) continue;
      const label = m.kind === 'PLACEMENT' ? 'placement proof due' : 'retention window ends';
      events.push({
        uid: `milestone-${m.id}@hiresettle`,
        date: due,
        summary: `${m.engagement.jobTitle}: ${m.name} (${label})`,
        description:
          `Engagement ${m.engagement.id}, milestone ${m.milestoneIndex} "${m.name}" — ` +
          `${m.paymentPercent}% of the fee. Status: ${m.status}.`,
      });
    }
    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // ----------------------------------------------------------
  // RFC 5545 rendering
  // ----------------------------------------------------------

  static buildIcs(events: CalendarEvent[], now: Date = new Date()): string {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//HireSettle//Milestone Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:HireSettle milestones',
    ];
    const stamp = CalendarService.formatDateTime(now);
    for (const event of events) {
      const end = new Date(event.date.getTime() + 24 * 60 * 60 * 1000);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${event.uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${CalendarService.formatDate(event.date)}`,
        `DTEND;VALUE=DATE:${CalendarService.formatDate(end)}`,
        `SUMMARY:${CalendarService.escapeText(event.summary)}`,
        `DESCRIPTION:${CalendarService.escapeText(event.description)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.map(CalendarService.foldLine).join('\r\n') + '\r\n';
  }

  /** TEXT escaping per RFC 5545 §3.3.11. */
  static escapeText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /** Folds content lines longer than 75 octets per RFC 5545 §3.1. */
  static foldLine(line: string): string {
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;
    const parts: string[] = [];
    let current = '';
    let currentBytes = 0;
    for (const char of line) {
      const bytes = Buffer.byteLength(char, 'utf8');
      // Continuation lines start with a space, which counts toward their 75 octets.
      const limit = parts.length === 0 ? 75 : 74;
      if (currentBytes + bytes > limit) {
        parts.push(current);
        current = '';
        currentBytes = 0;
      }
      current += char;
      currentBytes += bytes;
    }
    parts.push(current);
    return parts.join('\r\n ');
  }

  static formatDate(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  static formatDateTime(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
}
