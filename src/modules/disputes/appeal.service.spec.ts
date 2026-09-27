import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { DisputeAppealStatus, DisputeOutcome, DisputeStage, DisputeStatus, Prisma } from '@prisma/client';
import { AppealService } from './appeal.service';
import { ArbiterAssignmentService } from './arbiter-assignment.service';
import { DisputeSlaService } from './dispute-sla.service';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-27T12:00:00.000Z');

const engagement = {
  id: 'ENG-001',
  companyId: 'company-1',
  recruiterId: 'recruiter-1',
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
};

const resolvedDispute = () => ({
  id: 'dispute-1',
  engagementId: 'ENG-001',
  status: DisputeStatus.RESOLVED,
  stage: DisputeStage.ARBITER_REVIEW,
  arbiterId: 'arb-original',
  outcome: DisputeOutcome.RELEASE,
  resolvedAt: new Date(NOW.getTime() - 24 * HOUR),
  appealDeadline: new Date(NOW.getTime() + 48 * HOUR),
  isFinal: false,
  responseDeadline: null,
  slaStatus: 'MET',
  engagement,
  appeal: null as any,
});

const company = { id: 'company-1', role: 'COMPANY' };
const recruiter = { id: 'recruiter-1', role: 'RECRUITER' };
const appealFields = { stage: DisputeStage.APPEAL_REVIEW, responseDeadline: new Date(NOW.getTime() + 72 * HOUR), slaStatus: 'ON_TRACK', slaEscalatedAt: null };

describe('AppealService', () => {
  let service: AppealService;

  const prisma: any = {
    dispute: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    disputeAppeal: { create: jest.fn(), updateMany: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn((fn) => fn(prisma)),
  };
  const notifications = { notifyUserById: jest.fn().mockResolvedValue(undefined) };
  const disputes = {
    isParty: jest.fn((eng, user) => user.id === eng.companyId || user.id === eng.recruiterId),
    notifyParties: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn(),
  };
  const arbiters = { selectArbiter: jest.fn() };
  const sla = {
    stageFields: jest.fn().mockReturnValue(appealFields),
    completionStatus: jest.fn().mockReturnValue('MET'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    arbiters.selectArbiter.mockResolvedValue({ id: 'arb-second', name: 'Second', stellarAddress: 'GS', activeDisputes: 0 });
    prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
    prisma.disputeAppeal.create.mockImplementation(({ data }) => Promise.resolve({ id: 'appeal-1', ...data }));
    disputes.settle.mockImplementation((id) => Promise.resolve({ id, status: DisputeStatus.CLOSED, fundsLocked: false }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppealService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: DisputesService, useValue: disputes },
        { provide: ArbiterAssignmentService, useValue: arbiters },
        { provide: DisputeSlaService, useValue: sla },
      ],
    }).compile();
    service = module.get(AppealService);
  });

  describe('openAppeal()', () => {
    it('opens an appeal, locks funds and routes it to a different arbiter', async () => {
      prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());

      const appeal = await service.openAppeal('dispute-1', recruiter, 'Arbiter ignored my evidence', NOW);

      expect(arbiters.selectArbiter).toHaveBeenCalledWith(engagement, ['arb-original']);
      expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispute-1', status: DisputeStatus.RESOLVED, isFinal: false, appealDeadline: { gte: NOW } },
        data: expect.objectContaining({
          status: DisputeStatus.UNDER_REVIEW,
          arbiterId: 'arb-second',
          arbiterManuallyAssigned: false,
          fundsLocked: true,
          ...appealFields,
        }),
      });
      expect(sla.stageFields).toHaveBeenCalledWith(DisputeStage.APPEAL_REVIEW, NOW);
      expect(appeal).toMatchObject({
        disputeId: 'dispute-1',
        appellantId: 'recruiter-1',
        originalArbiterId: 'arb-original',
        arbiterId: 'arb-second',
        originalOutcome: DisputeOutcome.RELEASE,
      });
      expect(notifications.notifyUserById).toHaveBeenCalledWith(
        'arb-second',
        'ARBITER_ASSIGNED',
        'Appeal assigned',
        expect.any(String),
        expect.objectContaining({ disputeId: 'dispute-1' }),
      );
      expect(disputes.notifyParties).toHaveBeenCalledWith(
        'ENG-001',
        'DISPUTE_APPEALED',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        'recruiter-1',
      );
    });

    it('lets either party appeal', async () => {
      prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());
      await expect(service.openAppeal('dispute-1', company, 'reason', NOW)).resolves.toBeDefined();
    });

    it('rejects non-parties', async () => {
      prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());
      await expect(service.openAppeal('dispute-1', { id: 'stranger', role: 'COMPANY' }, 'r', NOW)).rejects.toThrow(
        ForbiddenException,
      );
    });

    describe('appeal window boundaries', () => {
      it('accepts an appeal at the exact deadline', async () => {
        const dispute = resolvedDispute();
        prisma.dispute.findUnique.mockResolvedValue(dispute);
        await expect(service.openAppeal('dispute-1', company, 'r', dispute.appealDeadline)).resolves.toBeDefined();
      });

      it('rejects an appeal one millisecond after the deadline', async () => {
        const dispute = resolvedDispute();
        prisma.dispute.findUnique.mockResolvedValue(dispute);
        const late = new Date(dispute.appealDeadline.getTime() + 1);

        await expect(service.openAppeal('dispute-1', company, 'r', late)).rejects.toThrow(UnprocessableEntityException);
        expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
      });

      it('rejects an appeal before any decision is recorded', async () => {
        prisma.dispute.findUnique.mockResolvedValue({
          ...resolvedDispute(),
          status: DisputeStatus.UNDER_REVIEW,
          outcome: null,
          appealDeadline: null,
        });
        await expect(service.openAppeal('dispute-1', company, 'r', NOW)).rejects.toThrow(UnprocessableEntityException);
      });
    });

    describe('single-appeal enforcement', () => {
      it('rejects a second appeal on the same dispute', async () => {
        prisma.dispute.findUnique.mockResolvedValue({ ...resolvedDispute(), appeal: { id: 'appeal-1' } });
        await expect(service.openAppeal('dispute-1', company, 'r', NOW)).rejects.toThrow(ConflictException);
      });

      it('rejects appeals on a final decision', async () => {
        prisma.dispute.findUnique.mockResolvedValue({ ...resolvedDispute(), isFinal: true });
        await expect(service.openAppeal('dispute-1', company, 'r', NOW)).rejects.toThrow(ConflictException);
      });

      it('maps a unique-constraint race to 409', async () => {
        prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());
        prisma.disputeAppeal.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5' }),
        );
        await expect(service.openAppeal('dispute-1', company, 'r', NOW)).rejects.toThrow(ConflictException);
      });

      it('rejects when the dispute was finalized concurrently', async () => {
        prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());
        prisma.dispute.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.openAppeal('dispute-1', company, 'r', NOW)).rejects.toThrow(ConflictException);
        expect(prisma.disputeAppeal.create).not.toHaveBeenCalled();
      });
    });

    it('queues the appeal for admins when no secondary arbiter is eligible', async () => {
      prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());
      arbiters.selectArbiter.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      const appeal = await service.openAppeal('dispute-1', company, 'r', NOW);

      expect(appeal.arbiterId).toBeNull();
      expect(prisma.dispute.updateMany.mock.calls[0][0].data).toMatchObject({
        status: DisputeStatus.OPEN,
        arbiterId: null,
        fundsLocked: true,
      });
      expect(notifications.notifyUserById).toHaveBeenCalledWith(
        'admin-1',
        'DISPUTE_APPEALED',
        'Appeal needs an arbiter',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('decideAppeal()', () => {
    const underAppeal = () => ({
      ...resolvedDispute(),
      status: DisputeStatus.UNDER_REVIEW,
      stage: DisputeStage.APPEAL_REVIEW,
      arbiterId: 'arb-second',
      appeal: {
        id: 'appeal-1',
        status: DisputeAppealStatus.OPEN,
        originalOutcome: DisputeOutcome.RELEASE,
        originalArbiterId: 'arb-original',
      },
    });

    it('records a final decision and settles immediately', async () => {
      prisma.dispute.findUnique.mockResolvedValue(underAppeal());
      prisma.disputeAppeal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.decideAppeal('dispute-1', { id: 'arb-second', role: 'ARBITER' }, DisputeOutcome.REFUND);

      expect(prisma.disputeAppeal.updateMany).toHaveBeenCalledWith({
        where: { id: 'appeal-1', status: DisputeAppealStatus.OPEN },
        data: expect.objectContaining({ status: DisputeAppealStatus.DECIDED, outcome: DisputeOutcome.REFUND, isFinal: true }),
      });
      expect(prisma.dispute.update).toHaveBeenCalledWith({
        where: { id: 'dispute-1' },
        data: expect.objectContaining({ status: DisputeStatus.RESOLVED, outcome: DisputeOutcome.REFUND, isFinal: true }),
      });
      expect(disputes.settle).toHaveBeenCalledWith('dispute-1');
      expect(result).toMatchObject({ status: DisputeStatus.CLOSED, fundsLocked: false });
      expect(disputes.notifyParties).toHaveBeenCalledWith(
        'ENG-001',
        'DISPUTE_APPEAL_DECIDED',
        'Appeal decided',
        expect.stringContaining('overturned'),
        expect.any(Object),
      );
    });

    it('closes the appeal window so the decided appeal can never be appealed again', async () => {
      prisma.dispute.findUnique.mockResolvedValue(underAppeal());
      prisma.disputeAppeal.updateMany.mockResolvedValue({ count: 1 });

      await service.decideAppeal('dispute-1', { id: 'arb-second', role: 'ARBITER' }, DisputeOutcome.RELEASE);
      const { data } = prisma.dispute.update.mock.calls[0][0];
      expect(data.isFinal).toBe(true);
      expect(data.appealDeadline.getTime()).toBeLessThanOrEqual(Date.now());

      // a subsequent appeal attempt on the now-final dispute is refused
      prisma.dispute.findUnique.mockResolvedValue({ ...resolvedDispute(), isFinal: true, appeal: underAppeal().appeal });
      await expect(service.openAppeal('dispute-1', company, 'again', NOW)).rejects.toThrow(ConflictException);
    });

    it('only the assigned appeal arbiter may decide', async () => {
      prisma.dispute.findUnique.mockResolvedValue(underAppeal());
      await expect(
        service.decideAppeal('dispute-1', { id: 'arb-original', role: 'ARBITER' }, DisputeOutcome.REFUND),
      ).rejects.toThrow(ForbiddenException);
      expect(disputes.settle).not.toHaveBeenCalled();
    });

    it('rejects when there is no open appeal', async () => {
      prisma.dispute.findUnique.mockResolvedValue(resolvedDispute());
      await expect(
        service.decideAppeal('dispute-1', { id: 'arb-second', role: 'ARBITER' }, DisputeOutcome.REFUND),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects a duplicate decision', async () => {
      prisma.dispute.findUnique.mockResolvedValue(underAppeal());
      prisma.disputeAppeal.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.decideAppeal('dispute-1', { id: 'arb-second', role: 'ARBITER' }, DisputeOutcome.REFUND),
      ).rejects.toThrow(ConflictException);
      expect(disputes.settle).not.toHaveBeenCalled();
    });
  });

  describe('finalizeExpiredAppealWindows() — fund locking', () => {
    it('keeps funds locked while the window is open (only lapsed windows are queried)', async () => {
      prisma.dispute.findMany.mockResolvedValue([]);
      await service.finalizeExpiredAppealWindows(NOW);
      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: DisputeStatus.RESOLVED, appealDeadline: { lt: NOW } } }),
      );
      expect(disputes.settle).not.toHaveBeenCalled();
    });

    it('marks lapsed decisions final, then settles them', async () => {
      prisma.dispute.findMany.mockResolvedValue([{ id: 'dispute-1', isFinal: false }]);

      await expect(service.finalizeExpiredAppealWindows(NOW)).resolves.toBe(1);

      expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispute-1', status: DisputeStatus.RESOLVED, isFinal: false, appealDeadline: { lt: NOW } },
        data: { isFinal: true },
      });
      expect(disputes.settle).toHaveBeenCalledWith('dispute-1');
    });

    it('skips disputes appealed between the query and the claim', async () => {
      prisma.dispute.findMany.mockResolvedValue([{ id: 'dispute-1', isFinal: false }]);
      prisma.dispute.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.finalizeExpiredAppealWindows(NOW)).resolves.toBe(0);
      expect(disputes.settle).not.toHaveBeenCalled();
    });

    it('retries settlement of already-final disputes and survives failures', async () => {
      prisma.dispute.findMany.mockResolvedValue([
        { id: 'dispute-1', isFinal: true },
        { id: 'dispute-2', isFinal: true },
      ]);
      disputes.settle.mockRejectedValueOnce(new Error('horizon down')).mockResolvedValueOnce({});

      await expect(service.finalizeExpiredAppealWindows(NOW)).resolves.toBe(1);
      expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
      expect(disputes.settle).toHaveBeenCalledTimes(2);
    });
  });
});
