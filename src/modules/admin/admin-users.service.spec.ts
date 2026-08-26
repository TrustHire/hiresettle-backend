import { Test, TestingModule } from '@nestjs/testing';
import { EngagementStatus, MilestoneStatus, UserRole } from '@prisma/client';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminUsersService } from './admin-users.service';

const mockPrisma = {
  engagement: {
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  milestone: {
    count: jest.fn(),
  },
  user: {
    groupBy: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: {} },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
    jest.clearAllMocks();
  });

  describe('getAdminMetrics()', () => {
    it('returns cached metrics without querying aggregates', async () => {
      const cached = { engagementsByStatus: { ACTIVE: 2 } };
      mockCache.get.mockResolvedValue(cached);

      await expect(service.getAdminMetrics()).resolves.toBe(cached);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns aggregate dashboard metrics and caches them for 60 seconds', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.$transaction.mockResolvedValue([
        [
          { status: EngagementStatus.ACTIVE, _count: { _all: 3 } },
          { status: EngagementStatus.COMPLETED, _count: { _all: 2 } },
        ],
        {
          _sum: {
            totalAmount: 10_000_000_000n,
            releasedAmount: 4_000_000_000n,
          },
        },
        5,
        [
          { role: UserRole.COMPANY, _count: { _all: 7 } },
          { role: UserRole.RECRUITER, _count: { _all: 4 } },
          { role: UserRole.ADMIN, _count: { _all: 1 } },
        ],
      ]);

      const result = await service.getAdminMetrics();

      expect(mockPrisma.engagement.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        _count: { _all: true },
      });
      expect(mockPrisma.engagement.aggregate).toHaveBeenCalledWith({
        _sum: {
          totalAmount: true,
          releasedAmount: true,
        },
      });
      expect(mockPrisma.milestone.count).toHaveBeenCalledWith({
        where: { status: MilestoneStatus.DISPUTED },
      });
      expect(mockPrisma.user.groupBy).toHaveBeenCalledWith({
        by: ['role'],
        _count: { _all: true },
      });
      expect(result).toEqual({
        engagementsByStatus: {
          ACTIVE: 3,
          COMPLETED: 2,
          CANCELLED: 0,
          REPLACEMENT_REQUESTED: 0,
        },
        totalMilestoneVolume: '10000000000',
        releasedAmount: '4000000000',
        lockedAmount: '6000000000',
        activeDisputesCount: 5,
        usersByRole: {
          COMPANY: 7,
          RECRUITER: 4,
          ARBITER: 0,
          ADMIN: 1,
        },
      });
      expect(mockCache.set).toHaveBeenCalledWith('admin:metrics', result, 60);
    });
  });
});
