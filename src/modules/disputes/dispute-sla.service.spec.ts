import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DisputeSlaStatus, DisputeStage } from '@prisma/client';
import { DisputeSlaService } from './dispute-sla.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-27T12:00:00.000Z');

describe('DisputeSlaService', () => {
  let service: DisputeSlaService;
  const prisma = {
    dispute: { findMany: jest.fn(), updateMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const notifications = { notifyUserById: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((key: string, fallback: unknown) => fallback) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputeSlaService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(DisputeSlaService);
  });

  describe('deadline calculation per stage', () => {
    it.each([
      [DisputeStage.ASSIGNMENT, 24],
      [DisputeStage.ARBITER_REVIEW, 72],
      [DisputeStage.APPEAL_REVIEW, 72],
    ])('%s defaults to %i hours', (stage, hours) => {
      expect(service.deadlineFor(stage, NOW)).toEqual(new Date(NOW.getTime() + hours * HOUR));
    });

    it('honours configured stage durations', async () => {
      const custom = { get: jest.fn((key: string, fallback: unknown) => (key === 'DISPUTE_SLA_REVIEW_HOURS' ? '12' : fallback)) };
      const module = await Test.createTestingModule({
        providers: [
          DisputeSlaService,
          { provide: PrismaService, useValue: prisma },
          { provide: NotificationsService, useValue: notifications },
          { provide: ConfigService, useValue: custom },
        ],
      }).compile();
      const svc = module.get(DisputeSlaService);

      expect(svc.deadlineFor(DisputeStage.ARBITER_REVIEW, NOW)).toEqual(new Date(NOW.getTime() + 12 * HOUR));
    });

    it('resets SLA tracking when a dispute enters a new stage', () => {
      expect(service.stageFields(DisputeStage.APPEAL_REVIEW, NOW)).toEqual({
        stage: DisputeStage.APPEAL_REVIEW,
        responseDeadline: new Date(NOW.getTime() + 72 * HOUR),
        slaStatus: DisputeSlaStatus.ON_TRACK,
        slaEscalatedAt: null,
      });
    });
  });

  describe('completionStatus()', () => {
    it('is MET when the stage completes before the deadline', () => {
      expect(
        service.completionStatus({ responseDeadline: new Date(NOW.getTime() + HOUR), slaStatus: DisputeSlaStatus.ON_TRACK }, NOW),
      ).toBe(DisputeSlaStatus.MET);
    });

    it('is OVERDUE when completed after the deadline, even if the job has not run yet', () => {
      expect(
        service.completionStatus({ responseDeadline: new Date(NOW.getTime() - HOUR), slaStatus: DisputeSlaStatus.ON_TRACK }, NOW),
      ).toBe(DisputeSlaStatus.OVERDUE);
    });

    it('stays OVERDUE once flagged', () => {
      expect(service.completionStatus({ responseDeadline: null, slaStatus: DisputeSlaStatus.OVERDUE }, NOW)).toBe(
        DisputeSlaStatus.OVERDUE,
      );
    });
  });

  describe('flagOverdueDisputes()', () => {
    const overdue = {
      id: 'dispute-1',
      engagementId: 'ENG-001',
      stage: DisputeStage.ARBITER_REVIEW,
      arbiterId: 'arbiter-1',
      responseDeadline: new Date(NOW.getTime() - HOUR),
    };

    it('only looks at active, on-track disputes past their deadline', async () => {
      prisma.dispute.findMany.mockResolvedValue([]);

      await expect(service.flagOverdueDisputes(NOW)).resolves.toBe(0);

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: { in: ['OPEN', 'UNDER_REVIEW'] },
            slaStatus: DisputeSlaStatus.ON_TRACK,
            responseDeadline: { lte: NOW },
          },
        }),
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('transitions overdue disputes to OVERDUE and notifies every admin', async () => {
      prisma.dispute.findMany.mockResolvedValue([overdue]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.flagOverdueDisputes(NOW)).resolves.toBe(1);

      expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispute-1', slaStatus: DisputeSlaStatus.ON_TRACK, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        data: { slaStatus: DisputeSlaStatus.OVERDUE, slaEscalatedAt: NOW },
      });
      expect(notifications.notifyUserById).toHaveBeenCalledTimes(2);
      expect(notifications.notifyUserById).toHaveBeenCalledWith(
        'admin-1',
        'DISPUTE_SLA_OVERDUE',
        'Dispute SLA breached',
        expect.stringContaining('dispute-1'),
        expect.objectContaining({ disputeId: 'dispute-1', stage: DisputeStage.ARBITER_REVIEW }),
      );
    });

    it('does not re-notify when another run already escalated the dispute', async () => {
      prisma.dispute.findMany.mockResolvedValue([overdue]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      prisma.dispute.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.flagOverdueDisputes(NOW)).resolves.toBe(0);
      expect(notifications.notifyUserById).not.toHaveBeenCalled();
    });
  });
});
