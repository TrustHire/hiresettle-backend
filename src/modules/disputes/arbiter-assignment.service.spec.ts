import { Test, TestingModule } from '@nestjs/testing';
import { DisputeStage, DisputeStatus } from '@prisma/client';
import { ArbiterAssignmentService } from './arbiter-assignment.service';
import { DisputeSlaService } from './dispute-sla.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const engagement = {
  id: 'ENG-001',
  companyId: 'company-1',
  recruiterId: 'recruiter-1',
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
};

const arbiters = [
  { id: 'arb-a', name: 'A', stellarAddress: 'GA' },
  { id: 'arb-b', name: 'B', stellarAddress: 'GB' },
  { id: 'arb-c', name: 'C', stellarAddress: 'GC' },
];

describe('ArbiterAssignmentService', () => {
  let service: ArbiterAssignmentService;
  const prisma = {
    arbiterRecusal: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    dispute: { groupBy: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    disputeAppeal: { update: jest.fn() },
  };
  const notifications = { notifyUserById: jest.fn().mockResolvedValue(undefined) };
  const reviewFields = { stage: DisputeStage.ARBITER_REVIEW, responseDeadline: new Date('2026-09-30'), slaStatus: 'ON_TRACK', slaEscalatedAt: null };
  const sla = { stageFields: jest.fn().mockReturnValue(reviewFields) };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.arbiterRecusal.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue(arbiters);
    prisma.dispute.groupBy.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArbiterAssignmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: DisputeSlaService, useValue: sla },
      ],
    }).compile();
    service = module.get(ArbiterAssignmentService);
  });

  describe('selectArbiter() — least workload', () => {
    it('picks the arbiter with the fewest open/under-review disputes', async () => {
      prisma.dispute.groupBy.mockResolvedValue([
        { arbiterId: 'arb-a', _count: { _all: 4 } },
        { arbiterId: 'arb-b', _count: { _all: 1 } },
        { arbiterId: 'arb-c', _count: { _all: 2 } },
      ]);

      const selected = await service.selectArbiter(engagement);

      expect(selected).toEqual({ id: 'arb-b', name: 'B', stellarAddress: 'GB', activeDisputes: 1 });
      expect(prisma.dispute.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { arbiterId: { in: ['arb-a', 'arb-b', 'arb-c'] }, status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } },
        }),
      );
    });

    it('treats arbiters with no active disputes as zero workload', async () => {
      prisma.dispute.groupBy.mockResolvedValue([
        { arbiterId: 'arb-a', _count: { _all: 1 } },
        { arbiterId: 'arb-b', _count: { _all: 1 } },
      ]);

      await expect(service.selectArbiter(engagement)).resolves.toMatchObject({ id: 'arb-c', activeDisputes: 0 });
    });

    it('breaks ties deterministically in favour of the longest-standing arbiter', async () => {
      await expect(service.selectArbiter(engagement)).resolves.toMatchObject({ id: 'arb-a' });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      );
    });

    it('only considers active arbiters', async () => {
      await service.selectArbiter(engagement);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'ARBITER', deactivatedAt: null, deletedAt: null }),
        }),
      );
    });
  });

  describe('selectArbiter() — recusal and conflict filtering', () => {
    it('excludes arbiters who recused themselves from the engagement', async () => {
      prisma.arbiterRecusal.findMany.mockResolvedValue([{ arbiterId: 'arb-a' }]);

      await service.selectArbiter(engagement);

      const { where } = prisma.user.findMany.mock.calls[0][0];
      expect(where.id.notIn).toEqual(expect.arrayContaining(['arb-a', 'company-1', 'recruiter-1']));
    });

    it('excludes arbiters whose wallet is a party to the engagement', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'arb-x', name: 'X', stellarAddress: 'GCOMPANY' }, arbiters[2]]);

      await expect(service.selectArbiter(engagement)).resolves.toMatchObject({ id: 'arb-c' });
    });

    it('honours explicit exclusions (e.g. the original arbiter on appeal)', async () => {
      await service.selectArbiter(engagement, ['arb-b']);

      const { where } = prisma.user.findMany.mock.calls[0][0];
      expect(where.id.notIn).toContain('arb-b');
    });

    it('returns null when nobody is eligible', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await expect(service.selectArbiter(engagement)).resolves.toBeNull();
      expect(prisma.dispute.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('autoAssign()', () => {
    const openDispute = {
      id: 'dispute-1',
      engagementId: 'ENG-001',
      status: DisputeStatus.OPEN,
      arbiterId: null,
      arbiterManuallyAssigned: false,
      engagement,
    };

    it('assigns the least-loaded arbiter, starts the review SLA and notifies them', async () => {
      prisma.dispute.findUnique.mockResolvedValueOnce(openDispute).mockResolvedValueOnce({ ...openDispute, arbiterId: 'arb-a' });
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.autoAssign('dispute-1');

      expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispute-1', arbiterId: null, arbiterManuallyAssigned: false },
        data: expect.objectContaining({ arbiterId: 'arb-a', status: DisputeStatus.UNDER_REVIEW, ...reviewFields }),
      });
      expect(sla.stageFields).toHaveBeenCalledWith(DisputeStage.ARBITER_REVIEW);
      expect(notifications.notifyUserById).toHaveBeenCalledWith(
        'arb-a',
        'ARBITER_ASSIGNED',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ disputeId: 'dispute-1' }),
      );
      expect(result).toMatchObject({ arbiterId: 'arb-a' });
    });

    it('never overrides a manual admin assignment', async () => {
      prisma.dispute.findUnique.mockResolvedValue({ ...openDispute, arbiterId: 'arb-manual', arbiterManuallyAssigned: true });

      await service.autoAssign('dispute-1');

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
    });

    it('loses cleanly to a concurrent manual override', async () => {
      prisma.dispute.findUnique.mockResolvedValue(openDispute);
      prisma.dispute.updateMany.mockResolvedValue({ count: 0 });

      await service.autoAssign('dispute-1');

      expect(notifications.notifyUserById).not.toHaveBeenCalled();
    });

    it('leaves the dispute awaiting manual assignment when no arbiter is eligible', async () => {
      prisma.dispute.findUnique.mockResolvedValue(openDispute);
      prisma.user.findMany.mockResolvedValue([]);

      await expect(service.autoAssign('dispute-1')).resolves.toBe(openDispute);
      expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('applyManualOverride() — admin precedence', () => {
    it('pins every active dispute on the engagement and flags it as manual', async () => {
      prisma.dispute.findMany.mockResolvedValue([
        { id: 'd-1', stage: DisputeStage.ASSIGNMENT, appeal: null },
        { id: 'd-2', stage: DisputeStage.ARBITER_REVIEW, appeal: null },
      ]);

      await expect(service.applyManualOverride('ENG-001', 'arb-admin-pick')).resolves.toBe(2);

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { engagementId: 'ENG-001', status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      );
      expect(prisma.dispute.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: expect.objectContaining({ arbiterId: 'arb-admin-pick', arbiterManuallyAssigned: true, ...reviewFields }),
      });
      // disputes already under review keep their running SLA clock
      expect(prisma.dispute.update.mock.calls[1][0].data).not.toHaveProperty('responseDeadline');
    });

    it('also reassigns an open appeal, but never to the arbiter being appealed', async () => {
      prisma.dispute.findMany.mockResolvedValue([
        { id: 'd-1', stage: DisputeStage.APPEAL_REVIEW, appeal: { id: 'appeal-1', originalArbiterId: 'arb-original' } },
      ]);

      await expect(service.applyManualOverride('ENG-001', 'arb-original')).resolves.toBe(0);
      expect(prisma.dispute.update).not.toHaveBeenCalled();

      await expect(service.applyManualOverride('ENG-001', 'arb-new')).resolves.toBe(1);
      expect(prisma.disputeAppeal.update).toHaveBeenCalledWith({ where: { id: 'appeal-1' }, data: { arbiterId: 'arb-new' } });
    });
  });
});
