import { Test, TestingModule } from '@nestjs/testing';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';

describe('RetentionSchedulerService', () => {
  let service: RetentionSchedulerService;
  let prisma: PrismaService;
  let stellar: StellarService;
  let notifications: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionSchedulerService,
        {
          provide: PrismaService,
          useValue: {
            retentionSchedule: {
              findMany: jest.fn(),
              update: jest.fn(),
            },
            engagement: {
              findUnique: jest.fn(),
            },
            milestone: {
              updateMany: jest.fn(),
            },
          },
        },
        {
          provide: StellarService,
          useValue: {
            isMilestoneUnlockable: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RetentionSchedulerService>(RetentionSchedulerService);
    prisma = module.get<PrismaService>(PrismaService);
    stellar = module.get<StellarService>(StellarService);
    notifications = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendApproachingNotifications', () => {
    it('should send notifications for retention schedules that are due soon', async () => {
      const mockSchedule = {
        id: 'schedule1',
        engagementId: 'engagement1',
        milestoneIndex: 1,
        notifyAt: new Date(),
        unlockAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        notified: false,
        unlocked: false,
      };
      const mockEngagement = {
        id: 'engagement1',
        jobTitle: 'Test Job',
        companyAddress: 'company1',
        recruiterAddress: 'recruiter1',
        milestones: [{ retentionDays: 30 }],
      };

      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([mockSchedule]);
      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue(mockEngagement);

      await service.sendApproachingNotifications();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalledWith({
        where: {
          notifyAt: { lte: expect.any(Date) },
          notified: false,
          unlocked: false,
        },
      });
      expect(prisma.engagement.findUnique).toHaveBeenCalledWith({
        where: { id: mockSchedule.engagementId },
        include: {
          milestones: {
            where: { milestoneIndex: mockSchedule.milestoneIndex },
          },
        },
      });
      expect(notifications.notifyUser).toHaveBeenCalledTimes(2); // Company and Recruiter
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        mockEngagement.companyAddress,
        NotificationType.RETENTION_WINDOW_APPROACHING,
        '30-day retention window closing soon',
        expect.stringContaining('The 30-day retention window for engagement engagement1 (Test Job) closes in approximately 3 days.'),
        {
          engagementId: mockEngagement.id,
          milestoneIndex: mockSchedule.milestoneIndex,
          unlockAt: mockSchedule.unlockAt,
        },
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        mockEngagement.recruiterAddress,
        NotificationType.RETENTION_WINDOW_APPROACHING,
        '30-day retention window closing soon',
        expect.stringContaining('The 30-day retention window for engagement engagement1 (Test Job) closes in approximately 3 days.'),
        {
          engagementId: mockEngagement.id,
          milestoneIndex: mockSchedule.milestoneIndex,
          unlockAt: mockSchedule.unlockAt,
        },
      );
      expect(prisma.retentionSchedule.update).toHaveBeenCalledWith({
        where: { id: mockSchedule.id },
        data: { notified: true },
      });
    });

    it('should not send notifications if no schedules are due soon', async () => {
      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([]);

      await service.sendApproachingNotifications();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalled();
      expect(prisma.engagement.findUnique).not.toHaveBeenCalled();
      expect(notifications.notifyUser).not.toHaveBeenCalled();
      expect(prisma.retentionSchedule.update).not.toHaveBeenCalled();
    });

    it('should handle errors during notification sending', async () => {
      const mockSchedule = {
        id: 'schedule1',
        engagementId: 'engagement1',
        milestoneIndex: 1,
        notifyAt: new Date(),
        unlockAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        notified: false,
        unlocked: false,
      };

      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([mockSchedule]);
      (prisma.engagement.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await service.sendApproachingNotifications();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalled();
      expect(prisma.engagement.findUnique).toHaveBeenCalled();
      expect(notifications.notifyUser).not.toHaveBeenCalled();
      expect(prisma.retentionSchedule.update).not.toHaveBeenCalled();
    });
  });

  describe('checkAndMarkUnlockable', () => {
    it('should mark milestones as unlocked and notify recruiter if unlock conditions are met', async () => {
      const mockSchedule = {
        id: 'schedule1',
        engagementId: 'engagement1',
        milestoneIndex: 1,
        notifyAt: new Date(Date.now() - 100000),
        unlockAt: new Date(Date.now() - 10000),
        notified: true,
        unlocked: false,
      };
      const mockEngagement = {
        id: 'engagement1',
        jobTitle: 'Test Job',
        companyAddress: 'company1',
        recruiterAddress: 'recruiter1',
        milestones: [{ retentionDays: 30 }],
      };

      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([mockSchedule]);
      (stellar.isMilestoneUnlockable as jest.Mock).mockResolvedValue(true);
      (prisma.milestone.updateMany as jest.Mock).mockResolvedValue(true);
      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue(mockEngagement);

      await service.checkAndMarkUnlockable();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalledWith({
        where: {
          unlockAt: { lte: expect.any(Date) },
          unlocked: false,
        },
      });
      expect(stellar.isMilestoneUnlockable).toHaveBeenCalledWith(
        mockSchedule.engagementId,
        mockSchedule.milestoneIndex,
      );
      expect(prisma.milestone.updateMany).toHaveBeenCalledWith({
        where: {
          engagementId: mockSchedule.engagementId,
          milestoneIndex: mockSchedule.milestoneIndex,
          status: 'LOCKED',
        },
        data: { status: 'PENDING' },
      });
      expect(prisma.retentionSchedule.update).toHaveBeenCalledWith({
        where: { id: mockSchedule.id },
        data: { unlocked: true },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        mockEngagement.recruiterAddress,
        NotificationType.MILESTONE_UNLOCKED,
        '30-day retention milestone unlocked',
        expect.stringContaining('The 30-day retention milestone for engagement engagement1 (Test Job) is now unlocked.'),
        {
          engagementId: mockEngagement.id,
          milestoneIndex: mockSchedule.milestoneIndex,
        },
      );
    });

    it('should not mark milestones as unlocked if unlock conditions are not met', async () => {
      const mockSchedule = {
        id: 'schedule1',
        engagementId: 'engagement1',
        milestoneIndex: 1,
        notifyAt: new Date(Date.now() - 100000),
        unlockAt: new Date(Date.now() - 10000),
        notified: true,
        unlocked: false,
      };

      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([mockSchedule]);
      (stellar.isMilestoneUnlockable as jest.Mock).mockResolvedValue(false);

      await service.checkAndMarkUnlockable();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalled();
      expect(stellar.isMilestoneUnlockable).toHaveBeenCalled();
      expect(prisma.milestone.updateMany).not.toHaveBeenCalled();
      expect(prisma.retentionSchedule.update).not.toHaveBeenCalled();
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('should not process if no schedules are due for unlock', async () => {
      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([]);

      await service.checkAndMarkUnlockable();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalled();
      expect(stellar.isMilestoneUnlockable).not.toHaveBeenCalled();
      expect(prisma.milestone.updateMany).not.toHaveBeenCalled();
      expect(prisma.retentionSchedule.update).not.toHaveBeenCalled();
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('should handle errors during unlock process', async () => {
      const mockSchedule = {
        id: 'schedule1',
        engagementId: 'engagement1',
        milestoneIndex: 1,
        notifyAt: new Date(Date.now() - 100000),
        unlockAt: new Date(Date.now() - 10000),
        notified: true,
        unlocked: false,
      };

      (prisma.retentionSchedule.findMany as jest.Mock).mockResolvedValue([mockSchedule]);
      (stellar.isMilestoneUnlockable as jest.Mock).mockRejectedValue(new Error('Stellar Error'));

      await service.checkAndMarkUnlockable();

      expect(prisma.retentionSchedule.findMany).toHaveBeenCalled();
      expect(stellar.isMilestoneUnlockable).toHaveBeenCalled();
      expect(prisma.milestone.updateMany).not.toHaveBeenCalled();
      expect(prisma.retentionSchedule.update).not.toHaveBeenCalled();
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });
  });
});
