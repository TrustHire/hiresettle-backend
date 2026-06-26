import { Test, TestingModule } from '@nestjs/testing';
import { EngagementsService } from './engagements.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  engagement: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  retentionSchedule: {
    create: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

const mockStellar = {
  getLatestLedger: jest.fn().mockResolvedValue(1000000),
  ledgerToDateTime: jest.fn().mockReturnValue(new Date('2026-07-15')),
  simulateContractCall: jest.fn(),
  stroopsToUsdc: jest.fn().mockReturnValue('500.00'),
  checkTokenBalance: jest.fn().mockResolvedValue({ sufficient: true, balance: BigInt('10000000000') }),
  submitCreateEngagement: jest.fn().mockResolvedValue({ txHash: 'abc123', ledger: 1000001 }),
};

describe('EngagementsService', () => {
  let service: EngagementsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
      ],
    }).compile();

    service = module.get<EngagementsService>(EngagementsService);
    jest.clearAllMocks();
  });

  describe('create()', () => {
    const dto = {
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
    };

    it('creates an engagement successfully', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      mockPrisma.engagement.create.mockResolvedValue({
        id: 'ENG-001',
        totalAmount: BigInt('5000000000'),
        releasedAmount: BigInt(0),
        status: 'ACTIVE',
        milestones: [
          { id: 'm0', milestoneIndex: 0, kind: 'PLACEMENT', status: 'PENDING', retentionDays: null, unlockEstimatedAt: null, paymentReleased: null },
          { id: 'm1', milestoneIndex: 1, kind: 'RETENTION', status: 'LOCKED', retentionDays: 30, unlockEstimatedAt: new Date('2026-07-12'), paymentReleased: null, validAfterLedger: 1518400 },
          { id: 'm2', milestoneIndex: 2, kind: 'RETENTION', status: 'LOCKED', retentionDays: 90, unlockEstimatedAt: new Date('2026-09-10'), paymentReleased: null, validAfterLedger: 2555200 },
        ],
      });
      mockPrisma.retentionSchedule.create.mockResolvedValue({});

      const result = await service.create(dto as any);
      expect(result.id).toBe('ENG-001');
      expect(mockPrisma.engagement.create).toHaveBeenCalledTimes(1);
      // Retention schedule created for each retention milestone
      expect(mockPrisma.retentionSchedule.create).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException if engagement already exists', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({ id: 'ENG-001' });
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne()', () => {
    it('returns engagement when found', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({
        id: 'ENG-001',
        totalAmount: BigInt(5000000000),
        releasedAmount: BigInt(0),
        milestones: [],
        events: [],
      });
      const result = await service.findOne('ENG-001');
      expect(result.id).toBe('ENG-001');
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);
      await expect(service.findOne('MISSING')).rejects.toThrow(NotFoundException);
    });
  });
});
