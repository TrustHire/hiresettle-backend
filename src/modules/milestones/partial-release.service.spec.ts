import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MilestoneStatus, PartialReleaseStatus, PartialRemainderAction } from '@prisma/client';
import { PartialReleaseService } from './partial-release.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';

const engagement = {
  id: 'ENG-001',
  companyId: 'company-1',
  recruiterId: 'recruiter-1',
  arbiterId: 'arbiter-1',
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
  arbiterAddress: 'GARBITER',
};
const company = { id: 'company-1', role: 'COMPANY', stellarAddress: 'GCOMPANY' };
const recruiter = { id: 'recruiter-1', role: 'RECRUITER', stellarAddress: 'GRECRUITER' };
const arbiter = { id: 'arbiter-1', role: 'ARBITER', stellarAddress: 'GARBITER' };

const milestone = (overrides: Record<string, unknown> = {}) => ({
  id: 'ms-0',
  engagementId: 'ENG-001',
  milestoneIndex: 0,
  status: MilestoneStatus.PROOF_SUBMITTED,
  amount: 1_000_000_000n,
  paymentReleased: null,
  engagement,
  ...overrides,
});

const proposal = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1',
  milestoneId: 'ms-0',
  engagementId: 'ENG-001',
  proposedById: 'company-1',
  releaseAmount: 600_000_000n,
  remainderAmount: 400_000_000n,
  remainderAction: PartialRemainderAction.REFUND,
  status: PartialReleaseStatus.PROPOSED,
  companyApproverId: 'company-1',
  companyApprovedAt: new Date('2026-09-20'),
  recruiterApproverId: null,
  recruiterApprovedAt: null,
  txHash: null,
  executedAt: null,
  ...overrides,
});

describe('PartialReleaseService', () => {
  let service: PartialReleaseService;
  let prisma: any;
  const stellar = { releasePartialMilestonePayment: jest.fn() };
  const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    stellar.releasePartialMilestonePayment.mockResolvedValue('tx-partial');
    prisma = {
      milestone: { findUnique: jest.fn().mockResolvedValue(milestone()), update: jest.fn().mockResolvedValue({}) },
      engagement: { update: jest.fn().mockResolvedValue({}) },
      refund: { upsert: jest.fn().mockResolvedValue({}) },
      milestoneAuditLog: { create: jest.fn().mockResolvedValue({}) },
      milestonePartialRelease: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(async ({ data }) => ({ id: 'pr-1', status: PartialReleaseStatus.PROPOSED, ...data })),
        update: jest.fn(async ({ data }) => ({ ...proposal(), ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartialReleaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: StellarService, useValue: stellar },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(PartialReleaseService);
  });

  describe('computeSplit() — payout calculations', () => {
    it('splits an explicit amount against the escrow still held', () => {
      expect(PartialReleaseService.computeSplit(1000n, 0n, { releaseAmount: '600' })).toEqual({
        releaseAmount: 600n,
        remainderAmount: 400n,
      });
    });

    it('applies a percentage to the remaining escrow, rounding down to the stroop', () => {
      expect(PartialReleaseService.computeSplit(1001n, 0n, { releasePercent: 33 })).toEqual({
        releaseAmount: 330n,
        remainderAmount: 671n,
      });
    });

    it('accounts for amounts already released', () => {
      expect(PartialReleaseService.computeSplit(1000n, 600n, { releasePercent: 50 })).toEqual({
        releaseAmount: 200n,
        remainderAmount: 200n,
      });
    });

    it('handles large stroop amounts without precision loss', () => {
      const total = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
      const { releaseAmount, remainderAmount } = PartialReleaseService.computeSplit(total, 0n, { releasePercent: 50 });
      expect(releaseAmount + remainderAmount).toBe(total);
    });

    it.each([
      ['a full release', { releaseAmount: '1000' }],
      ['more than is held', { releaseAmount: '1001' }],
      ['a zero percent release', { releasePercent: 0 }],
      ['both amount and percent', { releaseAmount: '10', releasePercent: 10 }],
      ['neither amount nor percent', {}],
    ])('rejects %s', (_label, terms) => {
      expect(() => PartialReleaseService.computeSplit(1000n, 0n, terms)).toThrow(BadRequestException);
    });

    it('rejects when nothing is left in escrow', () => {
      expect(() => PartialReleaseService.computeSplit(1000n, 1000n, { releasePercent: 10 })).toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('propose()', () => {
    it('records the split, counts as the proposer approval and notifies the other party', async () => {
      const result = await service.propose('ENG-001', 0, company, {
        releasePercent: 60,
        remainderAction: PartialRemainderAction.REFUND,
      });

      expect(prisma.milestonePartialRelease.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          releaseAmount: 600_000_000n,
          remainderAmount: 400_000_000n,
          companyApproverId: 'company-1',
          companyApprovedAt: expect.any(Date),
        }),
      });
      expect(prisma.milestonePartialRelease.create.mock.calls[0][0].data).not.toHaveProperty('recruiterApprovedAt');
      expect(result.releaseAmount).toBe('600000000');
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GRECRUITER',
        'PARTIAL_RELEASE_PROPOSED',
        'Partial release proposed',
        expect.stringContaining('refunded to the company'),
        expect.any(Object),
      );
      expect(prisma.milestoneAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PARTIAL_RELEASE_PROPOSED', changedBy: 'company-1' }),
      });
      expect(stellar.releasePartialMilestonePayment).not.toHaveBeenCalled();
    });

    it('does not let the arbiter propose', async () => {
      await expect(
        service.propose('ENG-001', 0, arbiter, { releasePercent: 50, remainderAction: PartialRemainderAction.RETAIN }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('only allows one open proposal per milestone', async () => {
      prisma.milestonePartialRelease.findFirst.mockResolvedValue(proposal());
      await expect(
        service.propose('ENG-001', 0, recruiter, { releasePercent: 50, remainderAction: PartialRemainderAction.RETAIN }),
      ).rejects.toThrow(ConflictException);
    });

    it('requires proof to be submitted or disputed', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestone({ status: MilestoneStatus.PENDING }));
      await expect(
        service.propose('ENG-001', 0, company, { releasePercent: 50, remainderAction: PartialRemainderAction.RETAIN }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('approve() — dual-party consensus', () => {
    it('does not execute unless the stored proposal carries both approvals', async () => {
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal());
      // e.g. the recruiter's approval was not persisted — only the company side is recorded
      prisma.milestonePartialRelease.findUniqueOrThrow.mockResolvedValue(proposal({ recruiterApprovedAt: null }));

      const result = await service.approve('ENG-001', 0, 'pr-1', recruiter);

      expect(stellar.releasePartialMilestonePayment).not.toHaveBeenCalled();
      expect(result.status).toBe(PartialReleaseStatus.PROPOSED);
    });

    it('rejects a second approval from the same side', async () => {
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal());
      prisma.milestonePartialRelease.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve('ENG-001', 0, 'pr-1', company)).rejects.toThrow(ConflictException);
      expect(prisma.milestonePartialRelease.updateMany).toHaveBeenCalledWith({
        where: { id: 'pr-1', status: PartialReleaseStatus.PROPOSED, companyApprovedAt: null },
        data: expect.objectContaining({ companyApproverId: 'company-1' }),
      });
    });

    it('executes on-chain once both parties approved and records the breakdown', async () => {
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal());
      prisma.milestonePartialRelease.findUniqueOrThrow.mockResolvedValue(proposal({ recruiterApprovedAt: new Date() }));

      const result = await service.approve('ENG-001', 0, 'pr-1', recruiter);

      expect(stellar.releasePartialMilestonePayment).toHaveBeenCalledWith('ENG-001', 0, 600_000_000n, true);
      expect(prisma.milestone.update).toHaveBeenCalledWith({
        where: { id: 'ms-0' },
        data: expect.objectContaining({ paymentReleased: 600_000_000n, status: MilestoneStatus.CONFIRMED }),
      });
      expect(prisma.engagement.update).toHaveBeenCalledWith({
        where: { id: 'ENG-001' },
        data: { releasedAmount: { increment: 600_000_000n } },
      });
      expect(prisma.refund.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ amount: 400_000_000n, status: 'COMPLETED' }) }),
      );
      expect(prisma.milestoneAuditLog.create).toHaveBeenCalledWith({
        data: {
          milestoneId: 'ms-0',
          fromStatus: MilestoneStatus.PROOF_SUBMITTED,
          toStatus: MilestoneStatus.CONFIRMED,
          changedBy: 'recruiter-1',
          action: 'PARTIAL_RELEASE_EXECUTED',
          details: expect.objectContaining({
            txHash: 'tx-partial',
            releaseAmount: '600000000',
            remainderAmount: '400000000',
            remainderAction: PartialRemainderAction.REFUND,
            previouslyReleased: '0',
            totalReleased: '600000000',
          }),
        },
      });
      expect(result).toMatchObject({ status: PartialReleaseStatus.EXECUTED, txHash: 'tx-partial' });
      expect(notifications.notifyUser).toHaveBeenCalledTimes(2);
    });

    it('keeps the remainder in escrow for RETAIN', async () => {
      const retain = proposal({ remainderAction: PartialRemainderAction.RETAIN, recruiterApprovedAt: new Date() });
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal({ remainderAction: PartialRemainderAction.RETAIN }));
      prisma.milestonePartialRelease.findUniqueOrThrow.mockResolvedValue(retain);

      await service.approve('ENG-001', 0, 'pr-1', recruiter);

      expect(stellar.releasePartialMilestonePayment).toHaveBeenCalledWith('ENG-001', 0, 600_000_000n, false);
      expect(prisma.milestone.update.mock.calls[0][0].data).not.toHaveProperty('status');
      expect(prisma.refund.upsert).not.toHaveBeenCalled();
    });

    it('claims execution so concurrent approvals cannot pay out twice', async () => {
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal());
      prisma.milestonePartialRelease.findUniqueOrThrow.mockResolvedValue(proposal({ recruiterApprovedAt: new Date() }));
      prisma.milestonePartialRelease.updateMany
        .mockResolvedValueOnce({ count: 1 }) // approval recorded
        .mockResolvedValueOnce({ count: 0 }); // execution already claimed elsewhere

      await service.approve('ENG-001', 0, 'pr-1', recruiter);

      expect(stellar.releasePartialMilestonePayment).not.toHaveBeenCalled();
    });

    it('marks the proposal FAILED and audits it when the chain rejects the payout', async () => {
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal());
      prisma.milestonePartialRelease.findUniqueOrThrow.mockResolvedValue(proposal({ recruiterApprovedAt: new Date() }));
      stellar.releasePartialMilestonePayment.mockRejectedValue(new Error('insufficient escrow'));

      await expect(service.approve('ENG-001', 0, 'pr-1', recruiter)).rejects.toThrow('insufficient escrow');

      expect(prisma.milestonePartialRelease.update).toHaveBeenCalledWith({
        where: { id: 'pr-1' },
        data: { status: PartialReleaseStatus.FAILED, failureReason: 'insufficient escrow', executedAt: null },
      });
      expect(prisma.milestoneAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PARTIAL_RELEASE_FAILED' }),
      });
      expect(prisma.milestone.update).not.toHaveBeenCalled();
    });

    it('404s for a proposal on another milestone', async () => {
      prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal({ milestoneId: 'ms-9' }));
      await expect(service.approve('ENG-001', 0, 'pr-1', recruiter)).rejects.toThrow('not found');
    });
  });

  it('hasDualApproval() requires both sides', () => {
    expect(PartialReleaseService.hasDualApproval({ companyApprovedAt: new Date(), recruiterApprovedAt: null })).toBe(false);
    expect(PartialReleaseService.hasDualApproval({ companyApprovedAt: new Date(), recruiterApprovedAt: new Date() })).toBe(true);
  });

  it('reject() closes an open proposal and audits it', async () => {
    prisma.milestonePartialRelease.findUnique.mockResolvedValue(proposal());

    const result = await service.reject('ENG-001', 0, 'pr-1', recruiter);

    expect(result.status).toBe(PartialReleaseStatus.REJECTED);
    expect(prisma.milestoneAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PARTIAL_RELEASE_REJECTED' }),
    });
  });
});
