import { Test, TestingModule } from '@nestjs/testing';
import { EngagementsService } from './engagements.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from './audit-log.service';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EngagementStatus, NotificationType, UserRole } from '@prisma/client';

// ----------------------------------------------------------------
// Shared mock factories
// ----------------------------------------------------------------

const makeMockPrisma = () => ({
  engagement: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  milestone: { findMany: jest.fn() },
  retentionSchedule: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  user: { findMany: jest.fn() },
  notification: { create: jest.fn() },
  $transaction: jest.fn((fn) => (typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn))),
});

let mockPrisma = makeMockPrisma();

const mockStellar = {
  isTokenAllowed: jest.fn().mockReturnValue(true),
  getLatestLedger: jest.fn().mockResolvedValue(1_000_000),
  ledgerToDateTime: jest.fn().mockReturnValue(new Date('2026-07-15')),
  simulateContractCall: jest.fn(),
  checkTokenBalance: jest.fn().mockResolvedValue({ sufficient: true, balance: 10_000_000_000n }),
  submitCreateEngagement: jest.fn().mockResolvedValue({ txHash: 'abc123', ledger: 1_000_001 }),
  cancelEngagement: jest.fn().mockResolvedValue('cancel_tx_hash'),
};

const mockNotifications = {
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyUserById: jest.fn().mockResolvedValue(undefined),
};

const mockAuditLog = {
  record: jest.fn().mockResolvedValue({}),
};

const baseUser = { id: 'user-1', role: 'COMPANY' } as any;

const baseDto = {
  engagementId: 'ENG-001',
  companyAddress: 'GABC',
  recruiterAddress: 'GDEF',
  arbiterAddress: 'GHIJ',
  tokenAddress: 'CKLM',
  totalAmount: '5000000000',
  jobTitle: 'Senior Engineer',
  milestones: [
    { name: 'Candidate Placed', paymentPercent: 30, kind: 'PLACEMENT' as const },
    { name: '30-Day Retention', paymentPercent: 40, kind: 'RETENTION' as const },
    { name: '90-Day Retention', paymentPercent: 30, kind: 'RETENTION' as const },
  ],
  retentionDays: [30, 90],
} as const;

const createdEngagement = {
  id: 'ENG-001',
  totalAmount: 5_000_000_000n,
  releasedAmount: 0n,
  status: 'ACTIVE',
  companyAddress: 'GABC',
  recruiterAddress: 'GDEF',
  arbiterAddress: 'GHIJ',
  milestones: [
    { id: 'm0', milestoneIndex: 0, kind: 'PLACEMENT', status: 'PENDING', retentionDays: null, unlockEstimatedAt: null, paymentReleased: null, validAfterLedger: null },
    { id: 'm1', milestoneIndex: 1, kind: 'RETENTION', status: 'LOCKED', retentionDays: 30, unlockEstimatedAt: new Date('2026-07-12'), paymentReleased: null, validAfterLedger: 1_518_400 },
    { id: 'm2', milestoneIndex: 2, kind: 'RETENTION', status: 'LOCKED', retentionDays: 90, unlockEstimatedAt: new Date('2026-09-10'), paymentReleased: null, validAfterLedger: 2_555_200 },
  ],
};

// ----------------------------------------------------------------

describe('EngagementsService', () => {
  let service: EngagementsService;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<EngagementsService>(EngagementsService);
    jest.clearAllMocks();
    mockStellar.isTokenAllowed.mockReturnValue(true);
    mockStellar.checkTokenBalance.mockResolvedValue({ sufficient: true, balance: 10_000_000_000n });
    mockStellar.submitCreateEngagement.mockResolvedValue({ txHash: 'abc123', ledger: 1_000_001 });
    mockStellar.getLatestLedger.mockResolvedValue(1_000_000);
    mockStellar.ledgerToDateTime.mockReturnValue(new Date('2026-07-15'));
  });

  // ----------------------------------------------------------
  // create()
  // ----------------------------------------------------------

  describe('create()', () => {
    beforeEach(() => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      mockPrisma.engagement.create.mockResolvedValue(createdEngagement);
      mockPrisma.retentionSchedule.create.mockResolvedValue({});
    });

    it('creates engagement and persists with retention schedules', async () => {
      const result = await service.create(baseUser, baseDto as any);
      expect(result.id).toBe('ENG-001');
      expect(mockStellar.submitCreateEngagement).toHaveBeenCalledTimes(1);
      expect(mockPrisma.engagement.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.retentionSchedule.create).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException when engagement already exists', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({ id: 'ENG-001' });
      await expect(service.create(baseUser, baseDto as any)).rejects.toThrow(ConflictException);
      expect(mockStellar.submitCreateEngagement).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when token is not allowed', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      mockStellar.isTokenAllowed.mockReturnValue(false);
      await expect(service.create(baseUser, baseDto as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when company has insufficient token balance', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      mockStellar.checkTokenBalance.mockResolvedValue({ sufficient: false, balance: 0n });
      await expect(service.create(baseUser, baseDto as any)).rejects.toThrow(BadRequestException);
      expect(mockStellar.submitCreateEngagement).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when milestone percents do not sum to 100', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      const bad = {
        ...baseDto,
        milestones: [
          { name: 'M1', paymentPercent: 50, kind: 'PLACEMENT' as const },
          { name: 'M2', paymentPercent: 40, kind: 'RETENTION' as const },
        ],
        retentionDays: [30],
      };
      await expect(service.create(baseUser, bad as any)).rejects.toThrow(BadRequestException);
    });

    it('serialises BigInt fields to strings in the response', async () => {
      const result = await service.create(baseUser, baseDto as any);
      expect(typeof result.totalAmount).toBe('string');
      expect(typeof result.releasedAmount).toBe('string');
    });

    it('propagates StellarError when on-chain submission fails', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      mockStellar.submitCreateEngagement.mockRejectedValue(new Error('Soroban error'));
      await expect(service.create(baseUser, baseDto as any)).rejects.toThrow('Soroban error');
      expect(mockPrisma.engagement.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus()', () => {
    it('records an audit log entry when an engagement status changes', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          engagement: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ status: EngagementStatus.ACTIVE }),
            update: jest.fn().mockResolvedValue({ id: 'ENG-001', status: EngagementStatus.CANCELLED }),
          },
          engagementAuditLog: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      await service.updateStatus('ENG-001', EngagementStatus.CANCELLED, 'user-1', 'Fraud detected');

      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          engagementId: 'ENG-001',
          fromStatus: EngagementStatus.ACTIVE,
          toStatus: EngagementStatus.CANCELLED,
          changedBy: 'user-1',
          reason: 'Fraud detected',
        }),
      );
    });
  });

  // ----------------------------------------------------------
  // cancel (updateEngagementStatusByAdmin → CANCELLED)
  // ----------------------------------------------------------

  describe('cancel via updateEngagementStatusByAdmin()', () => {
    const engagementRecord = {
      id: 'ENG-001',
      status: EngagementStatus.ACTIVE,
      companyAddress: 'GABC',
      recruiterAddress: 'GDEF',
      arbiterAddress: 'GHIJ',
      totalAmount: 5_000_000_000n,
      releasedAmount: 0n,
      milestones: [],
      events: [],
    };

    it('transitions engagement to CANCELLED and writes audit log', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(engagementRecord);
      mockPrisma.engagement.update.mockResolvedValue({ ...engagementRecord, status: EngagementStatus.CANCELLED });

      const result = await service.updateEngagementStatusByAdmin(
        'ENG-001',
        EngagementStatus.CANCELLED,
        'Fraud detected',
        'admin-1',
      );
      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          engagementId: 'ENG-001',
          fromStatus: EngagementStatus.ACTIVE,
          toStatus: EngagementStatus.CANCELLED,
          changedBy: 'admin-1',
        }),
      );
      expect(result).toBeDefined();
    });

    it('throws NotFoundException for unknown engagement id', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      await expect(
        service.updateEngagementStatusByAdmin('MISSING', EngagementStatus.CANCELLED, 'reason', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // replacement-request (updateEngagementStatusByAdmin → REPLACEMENT_REQUESTED)
  // ----------------------------------------------------------

  describe('replacement-request via updateEngagementStatusByAdmin()', () => {
    it('transitions status to REPLACEMENT_REQUESTED', async () => {
      const eng = {
        id: 'ENG-002',
        status: EngagementStatus.ACTIVE,
        companyAddress: 'GA',
        recruiterAddress: 'GB',
        arbiterAddress: 'GC',
        totalAmount: 1_000n,
        releasedAmount: 0n,
        milestones: [],
        events: [],
      };
      mockPrisma.engagement.findUnique.mockResolvedValue(eng);
      mockPrisma.engagement.update.mockResolvedValue({ ...eng, status: EngagementStatus.REPLACEMENT_REQUESTED });

      const result = await service.updateEngagementStatusByAdmin(
        'ENG-002',
        EngagementStatus.REPLACEMENT_REQUESTED,
        'Candidate left',
        'admin-1',
      );
      expect(result).toBeDefined();
    });
  });

  // ----------------------------------------------------------
  // recuseArbiter()
  // ----------------------------------------------------------

  describe('recuseArbiter()', () => {
    it('notifies admins when the assigned arbiter recuses', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({
        id: 'ENG-001',
        arbiter: { id: 'arbiter-1', name: 'Arbiter One' },
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'admin-1', role: UserRole.ADMIN, deactivatedAt: null },
      ]);

      const result = await service.recuseArbiter('ENG-001', 'arbiter-1', UserRole.ARBITER);

      expect(result).toEqual({ message: 'Recusal request sent successfully' });
      expect(mockNotifications.notifyUserById).toHaveBeenCalledWith(
        'admin-1',
        'ARBITER_RECUSAL_REQUESTED',
        'Arbiter Recusal Requested',
        expect.stringContaining('Arbiter Arbiter One has recused themselves'),
        { engagementId: 'ENG-001', arbiterId: 'arbiter-1' },
      );
    });
  });

  // ----------------------------------------------------------
  // summary / findAll()
  // ----------------------------------------------------------

  describe('findAll() — summary/listing', () => {
    it('returns paginated engagement list', async () => {
      const engList = [
        { ...createdEngagement, id: 'ENG-001' },
        { ...createdEngagement, id: 'ENG-002' },
      ];
      mockPrisma.$transaction.mockResolvedValue([engList, 2]);
      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('filters by companyAddress', async () => {
      mockPrisma.$transaction.mockResolvedValue([[createdEngagement], 1]);
      const result = await service.findAll({ companyAddress: 'GABC', page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
    });

    it('handles multiple status filter values', async () => {
      mockPrisma.$transaction.mockResolvedValue([[createdEngagement], 1]);
      const result = await service.findAll({ status: 'ACTIVE,COMPLETED', page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
    });

    it('returns empty list when no engagements match', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      const result = await service.findAll({ status: 'CANCELLED' });
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // findOne()
  // ----------------------------------------------------------

  describe('findOne()', () => {
    it('returns serialized engagement when found', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({ ...createdEngagement, events: [] });
      const result = await service.findOne('ENG-001');
      expect(result.id).toBe('ENG-001');
      expect(typeof result.totalAmount).toBe('string');
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      await expect(service.findOne('MISSING')).rejects.toThrow(NotFoundException);
    });
  });
});
