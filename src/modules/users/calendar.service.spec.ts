import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const NOW = new Date('2026-09-27T12:00:00.000Z');

const makeMockPrisma = () => ({
  user: { findUnique: jest.fn(), update: jest.fn() },
  milestone: { findMany: jest.fn() },
});

const placementMilestone = {
  id: 'ms-0',
  milestoneIndex: 0,
  name: 'Placement',
  kind: 'PLACEMENT',
  paymentPercent: 50,
  status: 'PENDING',
  placementDueAt: new Date('2026-10-05T09:00:00.000Z'),
  unlockEstimatedAt: null,
  engagement: { id: 'ENG-001', jobTitle: 'Senior Engineer' },
};

const retentionMilestone = {
  id: 'ms-1',
  milestoneIndex: 1,
  name: 'Retention, 90 days',
  kind: 'RETENTION',
  paymentPercent: 50,
  status: 'LOCKED',
  placementDueAt: null,
  unlockEstimatedAt: new Date('2026-12-30T00:00:00.000Z'),
  engagement: { id: 'ENG-001', jobTitle: 'Senior Engineer' },
};

describe('CalendarService', () => {
  let service: CalendarService;
  let prisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    prisma = makeMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CalendarService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CalendarService);
  });

  describe('token management', () => {
    it('regenerates a random token and stores only its SHA-256 hash', async () => {
      prisma.user.update.mockResolvedValue({});

      const { token, feedPath } = await service.regenerateToken('user-1');

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(feedPath).toBe(`/users/me/calendar.ics?token=${token}`);
      const { data } = prisma.user.update.mock.calls[0][0];
      expect(data.calendarTokenHash).toBe(CalendarService.hashToken(token));
      expect(data.calendarTokenHash).not.toBe(token);
      expect(data.calendarTokenCreatedAt).toBeInstanceOf(Date);
    });

    it('issues a different token on every regeneration', async () => {
      prisma.user.update.mockResolvedValue({});
      const first = await service.regenerateToken('user-1');
      const second = await service.regenerateToken('user-1');
      expect(first.token).not.toBe(second.token);
    });

    it('revokes by clearing the stored hash', async () => {
      prisma.user.update.mockResolvedValue({});
      await expect(service.revokeToken('user-1')).resolves.toEqual({ revoked: true });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { calendarTokenHash: null, calendarTokenCreatedAt: null },
      });
    });
  });

  describe('renderFeed()', () => {
    it('rejects a missing token', async () => {
      await expect(service.renderFeed(undefined, NOW)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an unknown or revoked token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.renderFeed('stale-token', NOW)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { calendarTokenHash: CalendarService.hashToken('stale-token') } }),
      );
    });

    it('rejects tokens belonging to deactivated users', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', stellarAddress: null, deactivatedAt: NOW, deletedAt: null });
      await expect(service.renderFeed('token', NOW)).rejects.toThrow(UnauthorizedException);
    });

    it('renders upcoming milestones for a valid token', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', stellarAddress: 'GABC', deactivatedAt: null, deletedAt: null });
      prisma.milestone.findMany.mockResolvedValue([retentionMilestone, placementMilestone]);

      const ics = await service.renderFeed('token', NOW);

      expect(ics).toContain('UID:milestone-ms-0@hiresettle');
      expect(ics).toContain('DTSTART;VALUE=DATE:20261005');
      expect(ics).toContain('DTSTART;VALUE=DATE:20261230');
      // chronological order
      expect(ics.indexOf('ms-0@')).toBeLessThan(ics.indexOf('ms-1@'));
    });
  });

  describe('upcomingMilestoneEvents()', () => {
    it('scopes the query to active engagements the user is party to and unsettled future milestones', async () => {
      prisma.milestone.findMany.mockResolvedValue([]);

      await service.upcomingMilestoneEvents({ id: 'user-1', stellarAddress: 'GABC' }, NOW);

      const { where } = prisma.milestone.findMany.mock.calls[0][0];
      expect(where.status).toEqual({ notIn: ['CONFIRMED', 'RESOLVED'] });
      expect(where.engagement.status.in).toEqual(['ACTIVE', 'PENDING_ACCEPTANCE', 'REPLACEMENT_REQUESTED']);
      expect(where.engagement.archivedAt).toBeNull();
      expect(where.engagement.OR).toEqual(
        expect.arrayContaining([{ companyId: 'user-1' }, { recruiterAddress: 'GABC' }, { arbiterAddress: 'GABC' }]),
      );
      expect(where.OR).toEqual([{ placementDueAt: { gte: NOW } }, { unlockEstimatedAt: { gte: NOW } }]);
    });

    it('uses the due date matching each milestone kind and skips past dates', async () => {
      prisma.milestone.findMany.mockResolvedValue([
        placementMilestone,
        // a placement milestone whose only future date is the (irrelevant) unlock estimate
        { ...placementMilestone, id: 'ms-x', placementDueAt: new Date('2026-01-01'), unlockEstimatedAt: new Date('2027-01-01') },
      ]);

      const events = await service.upcomingMilestoneEvents({ id: 'user-1', stellarAddress: null }, NOW);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        uid: 'milestone-ms-0@hiresettle',
        date: placementMilestone.placementDueAt,
        summary: 'Senior Engineer: Placement (placement proof due)',
      });
    });
  });

  describe('buildIcs() — RFC 5545 compliance', () => {
    const event = {
      uid: 'milestone-ms-0@hiresettle',
      date: new Date('2026-10-05T09:00:00.000Z'),
      summary: 'Engineer, Backend; Remote',
      description: 'Line one\nLine two \\ done',
    };

    it('wraps events in a VCALENDAR with the required properties', () => {
      const ics = CalendarService.buildIcs([event], NOW);
      const lines = ics.split('\r\n');

      expect(lines[0]).toBe('BEGIN:VCALENDAR');
      expect(lines).toContain('VERSION:2.0');
      expect(lines).toContain('PRODID:-//HireSettle//Milestone Calendar//EN');
      expect(lines).toContain('BEGIN:VEVENT');
      expect(lines).toContain('DTSTAMP:20260927T120000Z');
      expect(lines).toContain('DTSTART;VALUE=DATE:20261005');
      expect(lines).toContain('DTEND;VALUE=DATE:20261006');
      expect(lines).toContain('END:VEVENT');
      expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
    });

    it('uses CRLF line endings exclusively', () => {
      const ics = CalendarService.buildIcs([event], NOW);
      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    });

    it('escapes commas, semicolons, backslashes and newlines in TEXT values', () => {
      const ics = CalendarService.buildIcs([event], NOW);
      expect(ics).toContain('SUMMARY:Engineer\\, Backend\\; Remote');
      expect(ics).toContain('DESCRIPTION:Line one\\nLine two \\\\ done');
    });

    it('renders an empty but valid calendar when nothing is due', () => {
      const ics = CalendarService.buildIcs([], NOW);
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).not.toContain('BEGIN:VEVENT');
    });

    it('folds lines longer than 75 octets', () => {
      const long = 'SUMMARY:' + 'x'.repeat(200);
      const folded = CalendarService.foldLine(long);
      const parts = folded.split('\r\n');

      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
      for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
      expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
    });

    it('never splits a multi-byte character when folding', () => {
      const long = 'SUMMARY:' + 'é'.repeat(100);
      const parts = CalendarService.foldLine(long).split('\r\n');
      for (const part of parts) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
      expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
    });
  });
});
