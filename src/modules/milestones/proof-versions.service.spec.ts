import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MilestoneStatus, Prisma, ProofVersionStatus } from '@prisma/client';
import { ProofVersionsService } from './proof-versions.service';
import { PrismaService } from '../../common/prisma/prisma.service';
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
const recruiter = { id: 'recruiter-1', role: 'RECRUITER', stellarAddress: 'GRECRUITER' };
const company = { id: 'company-1', role: 'COMPANY', stellarAddress: 'GCOMPANY' };

const milestoneRow = (status: MilestoneStatus) => ({
  id: 'ms-0',
  engagementId: 'ENG-001',
  milestoneIndex: 0,
  status,
  engagement,
});

const version = (versionNumber: number, status: ProofVersionStatus) => ({
  id: `pv-${versionNumber}`,
  milestoneId: 'ms-0',
  versionNumber,
  status,
  proofHash: null,
});

describe('ProofVersionsService', () => {
  let service: ProofVersionsService;
  let prisma: any;
  const notifications = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyUserById: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      milestone: { findUnique: jest.fn(), update: jest.fn(async ({ data }) => ({ id: 'ms-0', ...data })) },
      milestoneProofVersion: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(async ({ data }) => ({ id: `pv-${data.versionNumber}`, ...data, status: ProofVersionStatus.SUBMITTED })),
        update: jest.fn(async ({ data }) => data),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      milestoneApproval: { deleteMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProofVersionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(ProofVersionsService);
  });

  describe('sequential versioning', () => {
    it('starts at version 1', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(null);

      const created = await service.recordVersion('ms-0', { proofUrl: 'https://proof/1' });

      expect(prisma.milestoneProofVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ milestoneId: 'ms-0', versionNumber: 1, proofUrl: 'https://proof/1' }),
      });
      expect(created.versionNumber).toBe(1);
    });

    it('increments past the latest reviewed version', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(3, ProofVersionStatus.REJECTED));

      const created = await service.recordVersion('ms-0', { content: 'new offer letter' });

      expect(created.versionNumber).toBe(4);
    });

    it('does not create a new version while the latest is still awaiting review', async () => {
      const pending = version(2, ProofVersionStatus.SUBMITTED);
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(pending);

      await expect(service.recordVersion('ms-0', {})).resolves.toBe(pending);
      expect(prisma.milestoneProofVersion.create).not.toHaveBeenCalled();
    });

    it('fills in the on-chain hash on the pending version', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(2, ProofVersionStatus.SUBMITTED));

      await service.recordVersion('ms-0', { proofHash: 'abc123' });

      expect(prisma.milestoneProofVersion.update).toHaveBeenCalledWith({ where: { id: 'pv-2' }, data: { proofHash: 'abc123' } });
    });

    it('retries once when a concurrent submission took the version number', async () => {
      prisma.milestoneProofVersion.findFirst
        .mockResolvedValueOnce(version(1, ProofVersionStatus.REJECTED))
        .mockResolvedValueOnce(version(2, ProofVersionStatus.REJECTED));
      prisma.milestoneProofVersion.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5' }),
      );

      const created = await service.recordVersion('ms-0', { content: 'x' });

      expect(created.versionNumber).toBe(3);
    });

    it('lists history newest first', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([]);
      await service.history('ms-0');
      expect(prisma.milestoneProofVersion.findMany).toHaveBeenCalledWith({
        where: { milestoneId: 'ms-0' },
        orderBy: { versionNumber: 'desc' },
      });
    });
  });

  describe('submitProof()', () => {
    it('lets the recruiter submit and moves the milestone to PROOF_SUBMITTED', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PENDING));
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(null);

      const result = await service.submitProof('ENG-001', 0, recruiter, { proofUrl: 'https://proof/1' });

      expect(result.status).toBe(MilestoneStatus.PROOF_SUBMITTED);
      expect(result.proofVersion.versionNumber).toBe(1);
      expect(prisma.milestoneProofVersion.create.mock.calls[0][0].data.submittedById).toBe('recruiter-1');
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GCOMPANY',
        'PROOF_SUBMITTED',
        'Proof submitted — action required',
        expect.any(String),
        expect.objectContaining({ versionNumber: 1 }),
      );
    });

    it('rejects non-recruiters', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PENDING));
      await expect(service.submitProof('ENG-001', 0, company, { content: 'x' })).rejects.toThrow(ForbiddenException);
    });

    it('requires some proof', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PENDING));
      await expect(service.submitProof('ENG-001', 0, recruiter, {})).rejects.toThrow(BadRequestException);
    });

    it('refuses to overwrite proof that is still under review', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PROOF_SUBMITTED));
      await expect(service.submitProof('ENG-001', 0, recruiter, { content: 'x' })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.milestoneProofVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('rejection then resubmission', () => {
    it('rejecting keeps the version, returns the milestone to PENDING and clears approvals', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PROOF_SUBMITTED));
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(1, ProofVersionStatus.SUBMITTED));

      const result = await service.rejectProof('ENG-001', 0, company, 'Offer letter unsigned');

      expect(prisma.milestoneProofVersion.updateMany).toHaveBeenCalledWith({
        where: { id: 'pv-1', status: ProofVersionStatus.SUBMITTED },
        data: expect.objectContaining({
          status: ProofVersionStatus.REJECTED,
          reviewedById: 'company-1',
          rejectionReason: 'Offer letter unsigned',
        }),
      });
      expect(result.status).toBe(MilestoneStatus.PENDING);
      expect(prisma.milestoneApproval.deleteMany).toHaveBeenCalledWith({ where: { milestoneId: 'ms-0' } });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GRECRUITER',
        'PROOF_REJECTED',
        'Proof rejected',
        expect.stringContaining('Offer letter unsigned'),
        expect.objectContaining({ versionNumber: 1 }),
      );
    });

    it('a resubmission after rejection becomes version 2', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PENDING));
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(1, ProofVersionStatus.REJECTED));

      const result = await service.submitProof('ENG-001', 0, recruiter, { proofUrl: 'https://proof/2' });

      expect(result.proofVersion.versionNumber).toBe(2);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GCOMPANY',
        'PROOF_SUBMITTED',
        'Proof resubmitted — action required',
        expect.any(String),
        expect.objectContaining({ versionNumber: 2 }),
      );
    });

    it('only the company may reject', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PROOF_SUBMITTED));
      await expect(service.rejectProof('ENG-001', 0, recruiter, 'no')).rejects.toThrow(ForbiddenException);
    });

    it('cannot reject twice', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PROOF_SUBMITTED));
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(1, ProofVersionStatus.SUBMITTED));
      prisma.milestoneProofVersion.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rejectProof('ENG-001', 0, company, 'no')).rejects.toThrow(ConflictException);
    });
  });

  describe('assertReviewable() — only the latest version can be acted on', () => {
    it('rejects an approval that names an older version', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(2, ProofVersionStatus.SUBMITTED));
      await expect(service.assertReviewable('ms-0', 1)).rejects.toThrow(ConflictException);
    });

    it('accepts the latest pending version', async () => {
      const latest = version(2, ProofVersionStatus.SUBMITTED);
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(latest);
      await expect(service.assertReviewable('ms-0', 2)).resolves.toBe(latest);
      await expect(service.assertReviewable('ms-0')).resolves.toBe(latest);
    });

    it('rejects when the latest version was already reviewed', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(2, ProofVersionStatus.REJECTED));
      await expect(service.assertReviewable('ms-0')).rejects.toThrow(ConflictException);
    });

    it('allows legacy milestones without versions when no version is named', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(null);
      await expect(service.assertReviewable('ms-0')).resolves.toBeNull();
      await expect(service.assertReviewable('ms-0', 1)).rejects.toThrow(ConflictException);
    });

    it('rejectProof also refuses an outdated version number', async () => {
      prisma.milestone.findUnique.mockResolvedValue(milestoneRow(MilestoneStatus.PROOF_SUBMITTED));
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(3, ProofVersionStatus.SUBMITTED));

      await expect(service.rejectProof('ENG-001', 0, company, 'no', 2)).rejects.toThrow(ConflictException);
      expect(prisma.milestoneProofVersion.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markApproved()', () => {
    it('approves the pending latest version', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(version(2, ProofVersionStatus.SUBMITTED));
      await service.markApproved('ms-0', 'company-1');
      expect(prisma.milestoneProofVersion.update).toHaveBeenCalledWith({
        where: { id: 'pv-2' },
        data: expect.objectContaining({ status: ProofVersionStatus.APPROVED, reviewedById: 'company-1' }),
      });
    });

    it('is a no-op for legacy milestones', async () => {
      prisma.milestoneProofVersion.findFirst.mockResolvedValue(null);
      await expect(service.markApproved('ms-0', null)).resolves.toBeNull();
    });
  });
});
