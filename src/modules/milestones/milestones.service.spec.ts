import { Test, TestingModule } from '@nestjs/testing';
import { MilestonesService } from './milestones.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotFoundException, UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { MilestoneStatus } from '@prisma/client';

// ----------------------------------------------------------------
// Shared mock factories
// ----------------------------------------------------------------

const makeMockPrisma = () => ({
  milestone: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  engagement: {
    findUnique: jest.fn(),
  },
  retentionSchedule: {
    create: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  notification: { create: jest.fn() },
  $transaction: jest.fn((fn) => (typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn))),
});

let mockPrisma = makeMockPrisma();

const mockStellar = {
  isMilestoneUnlockable: jest.fn().mockResolvedValue(false),
  ledgersUntilUnlock: jest.fn().mockResolvedValue(17_280),
  ledgersToDays: jest.fn().mockReturnValue(1),
  releaseMilestonePayment: jest.fn().mockResolvedValue('release_tx'),
  resolveMilestoneDispute: jest.fn().mockResolvedValue('resolve_tx'),
  unlockRetentionMilestone: jest.fn().mockResolvedValue('unlock_tx'),
  getCurrentLedgerSequence: jest.fn().mockResolvedValue(1_000_000),
  ledgerToDateTime: jest.fn().mockReturnValue(new Date('2026-07-20')),
};

const mockNotifications = {
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyUserById: jest.fn().mockResolvedValue(undefined),
};

const baseEngagement = {
  id: 'ENG-001',
  companyId: 'company-1',
  recruiterId: 'recruiter-1',
  arbiterId: 'arbiter-1',
  companyAddress: 'GABC',
  recruiterAddress: 'GDEF',
  arbiterAddress: 'GHIJ',
};

const pendingMilestone = {
  id: 'ms-0',
  engagementId: 'ENG-001',
  milestoneIndex: 0,
  kind: 'PLACEMENT',
  status: MilestoneStatus.PENDING,
  proofHash: null,
  amount: '1500000000',
  retentionDays: null,
  validAfterLedger: null,
  unlockEstimatedAt: null,
  paymentReleased: null,
  confirmedAt: null,
};

const proofSubmittedMilestone = { ...pendingMilestone, status: MilestoneStatus.PROOF_SUBMITTED, proofHash: 'proof_abc' };
const disputedMilestone = { ...pendingMilestone, status: MilestoneStatus.DISPUTED, proofHash: 'proof_abc' };
const lockedMilestone = {
  ...pendingMilestone,
  id: 'ms-1',
  milestoneIndex: 1,
  kind: 'RETENTION',
  status: MilestoneStatus.LOCKED,
  retentionDays: 30,
  validAfterLedger: 1_518_400,
  unlockEstimatedAt: new Date('2026-07-20'),
};

// ----------------------------------------------------------------

describe('MilestonesService', () => {
  let service: MilestonesService;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<MilestonesService>(MilestonesService);
    jest.clearAllMocks();
    mockStellar.isMilestoneUnlockable.mockResolvedValue(false);
    mockStellar.ledgersUntilUnlock.mockResolvedValue(17_280);
    mockStellar.ledgersToDays.mockReturnValue(1);
    mockStellar.releaseMilestonePayment.mockResolvedValue('release_tx');
    mockStellar.resolveMilestoneDispute.mockResolvedValue('resolve_tx');
    mockStellar.unlockRetentionMilestone.mockResolvedValue('unlock_tx');
    mockStellar.getCurrentLedgerSequence.mockResolvedValue(1_000_000);
  });

  // ----------------------------------------------------------
  // submit-proof
  // ----------------------------------------------------------

  describe('submitProofFlow()', () => {
    it('transitions PENDING → PROOF_SUBMITTED and notifies company', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(pendingMilestone);
      mockPrisma.milestone.update.mockResolvedValue(proofSubmittedMilestone);
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.submitProofFlow('ENG-001', 0, 'proof_abc');

      expect(mockPrisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MilestoneStatus.PROOF_SUBMITTED,
            proofHash: 'proof_abc',
          }),
        }),
      );
      expect(result.status).toBe(MilestoneStatus.PROOF_SUBMITTED);
    });

    it('throws UnprocessableEntityException when milestone is not PENDING', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(proofSubmittedMilestone);
      await expect(service.submitProofFlow('ENG-001', 0, 'proof_abc')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockPrisma.milestone.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when milestone does not exist', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(null);
      await expect(service.submitProofFlow('ENG-001', 0, 'proof_abc')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // confirm
  // ----------------------------------------------------------

  describe('confirmFlow()', () => {
    it('calls releaseMilestonePayment on chain then marks CONFIRMED', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(proofSubmittedMilestone);
      mockPrisma.milestone.update.mockResolvedValue({
        ...proofSubmittedMilestone,
        status: MilestoneStatus.CONFIRMED,
        paymentReleased: 1_500_000_000n,
        confirmedAt: new Date(),
      });
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.confirmFlow('ENG-001', 0);

      expect(mockStellar.releaseMilestonePayment).toHaveBeenCalledWith('ENG-001', 0);
      expect(mockPrisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MilestoneStatus.CONFIRMED }),
        }),
      );
      expect(result.status).toBe(MilestoneStatus.CONFIRMED);
    });

    it('throws UnprocessableEntityException when milestone is not PROOF_SUBMITTED', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(pendingMilestone);
      await expect(service.confirmFlow('ENG-001', 0)).rejects.toThrow(UnprocessableEntityException);
      expect(mockStellar.releaseMilestonePayment).not.toHaveBeenCalled();
    });

    it('rolls back (no DB update) when on-chain payment release fails', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(proofSubmittedMilestone);
      mockStellar.releaseMilestonePayment.mockRejectedValue(new Error('chain error'));

      await expect(service.confirmFlow('ENG-001', 0)).rejects.toThrow('chain error');
      expect(mockPrisma.milestone.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // dispute
  // ----------------------------------------------------------

  describe('disputeFlow()', () => {
    it('transitions PROOF_SUBMITTED → DISPUTED with reason and notifies all parties', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(proofSubmittedMilestone);
      mockPrisma.milestone.update.mockResolvedValue({ ...disputedMilestone });
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.disputeFlow('ENG-001', 0, 'Deliverable not met');

      expect(mockPrisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MilestoneStatus.DISPUTED,
            disputeReason: 'Deliverable not met',
          }),
        }),
      );
      expect(result.status).toBe(MilestoneStatus.DISPUTED);
    });

    it('throws UnprocessableEntityException when milestone is not PROOF_SUBMITTED', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(pendingMilestone);
      await expect(service.disputeFlow('ENG-001', 0, 'reason')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  // ----------------------------------------------------------
  // resolve-dispute
  // ----------------------------------------------------------

  describe('resolveDisputeFlow()', () => {
    it('calls resolveMilestoneDispute on chain with approved=true then marks RESOLVED', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(disputedMilestone);
      mockPrisma.milestone.update.mockResolvedValue({
        ...disputedMilestone,
        status: MilestoneStatus.RESOLVED,
        paymentReleased: 1_500_000_000n,
        confirmedAt: new Date(),
      });
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.notification.create.mockResolvedValue({});

      const result = await service.resolveDisputeFlow('ENG-001', 0, 'RELEASE');

      expect(mockStellar.resolveMilestoneDispute).toHaveBeenCalledWith('ENG-001', 0, true);
      expect(mockPrisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MilestoneStatus.RESOLVED }),
        }),
      );
      expect(result.status).toBe(MilestoneStatus.RESOLVED);
    });

    it('calls resolveMilestoneDispute with approved=false for REFUND resolution', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(disputedMilestone);
      mockPrisma.milestone.update.mockResolvedValue({
        ...disputedMilestone,
        status: MilestoneStatus.PENDING,
      });
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.notification.create.mockResolvedValue({});

      await service.resolveDisputeFlow('ENG-001', 0, 'REFUND');

      expect(mockStellar.resolveMilestoneDispute).toHaveBeenCalledWith('ENG-001', 0, false);
    });

    it('throws UnprocessableEntityException when milestone is not DISPUTED', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(proofSubmittedMilestone);
      await expect(service.resolveDisputeFlow('ENG-001', 0, 'RELEASE')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockStellar.resolveMilestoneDispute).not.toHaveBeenCalled();
    });

    it('does not write DB update when on-chain call fails', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(disputedMilestone);
      mockStellar.resolveMilestoneDispute.mockRejectedValue(new Error('tx rejected'));

      await expect(service.resolveDisputeFlow('ENG-001', 0, 'RELEASE')).rejects.toThrow('tx rejected');
      expect(mockPrisma.milestone.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // retention-timing guard (getRetentionTimer)
  // ----------------------------------------------------------

  describe('getRetentionTimer() — retention-timing guard', () => {
    it('returns daysRemaining=0 and unlockable=true when chain reports unlockable', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(lockedMilestone);
      mockStellar.isMilestoneUnlockable.mockResolvedValue(true);

      const result = await service.getRetentionTimer('ENG-001', 1);

      expect(result.daysRemaining).toBe(0);
      expect(result.unlockable).toBe(true);
      expect(mockStellar.ledgersUntilUnlock).not.toHaveBeenCalled();
    });

    it('queries ledgers remaining when milestone is not yet unlockable', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(lockedMilestone);
      mockStellar.isMilestoneUnlockable.mockResolvedValue(false);
      mockStellar.ledgersUntilUnlock.mockResolvedValue(8_640);
      mockStellar.ledgersToDays.mockReturnValue(1);

      const result = await service.getRetentionTimer('ENG-001', 1);

      expect(result.unlockable).toBe(false);
      expect(mockStellar.ledgersUntilUnlock).toHaveBeenCalledWith('ENG-001', 1);
      expect(result.daysRemaining).toBe(1);
      expect(result.estimatedUnlockAt).toEqual(lockedMilestone.unlockEstimatedAt);
    });

    it('throws NotFoundException when milestone does not exist', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(null);
      await expect(service.getRetentionTimer('ENG-001', 99)).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // findByEngagementForUser — access control
  // ----------------------------------------------------------

  describe('findByEngagementForUser() — party access check', () => {
    it('returns milestones for a party member', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.milestone.findMany.mockResolvedValue([pendingMilestone]);

      const user = { role: 'COMPANY', stellarAddress: 'GABC' };
      const result = await service.findByEngagementForUser('ENG-001', user);

      expect(result).toHaveLength(1);
    });

    it('throws ForbiddenException for non-party member', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      const outsider = { role: 'RECRUITER', stellarAddress: 'GXXX' };
      await expect(service.findByEngagementForUser('ENG-001', outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows ADMIN to bypass party check', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.milestone.findMany.mockResolvedValue([pendingMilestone]);

      const admin = { role: 'ADMIN', stellarAddress: 'GADMIN' };
      const result = await service.findByEngagementForUser('ENG-001', admin);

      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      const user = { role: 'COMPANY', stellarAddress: 'GABC' };
      await expect(service.findByEngagementForUser('ENG-001', user)).rejects.toThrow(NotFoundException);
    });
  });
});
