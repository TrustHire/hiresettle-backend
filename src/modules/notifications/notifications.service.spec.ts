import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationType } from '@prisma/client';

// Mock nodemailer to prevent actual email sending during tests
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue(true),
  }),
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;
  let config: ConfigService;
  let mockNodemailerSendMail: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
            },
            notification: {
              create: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
              findMany: jest.fn(),
            },
            notificationPreference: {
              findUnique: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SMTP_HOST') return 'smtp.test.com';
              if (key === 'SMTP_PORT') return 587;
              if (key === 'SMTP_USER') return 'testuser';
              if (key === 'SMTP_PASS') return 'testpass';
              if (key === 'EMAIL_FROM') return 'test@example.com';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
    config = module.get<ConfigService>(ConfigService);
    mockNodemailerSendMail = (nodemailer.createTransport as jest.Mock)().sendMail;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('notifyUser', () => {
    const stellarAddress = 'test_stellar_address';
    const userId = 'test_user_id';
    const email = 'test@example.com';
    const title = 'Test Notification';
    const message = 'This is a test message.';
    const data = { key: 'value' };

    beforeEach(() => {
      jest.clearAllMocks();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        stellarAddress,
        email,
      });
      (prisma.notification.create as jest.Mock).mockResolvedValue({
        id: 'notification_id',
        userId,
        type: NotificationType.PAYMENT_RELEASED,
        title,
        message,
        data,
        read: false,
        emailSent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null); // Default to email enabled
    });

    it('should create a notification and send email if user has email and preferences allow', async () => {
      const notificationType = NotificationType.PAYMENT_RELEASED;
      const result = await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { stellarAddress } });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { userId, type: notificationType, title, message, data },
      });
      expect(mockNodemailerSendMail).toHaveBeenCalledWith({
        from: 'test@example.com',
        to: email,
        subject: '💰 HireSettle — Test Notification',
        text: message,
        html: expect.any(String),
      });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notification_id' },
        data: { emailSent: true },
      });
      expect(result).toBeDefined();
      expect(result?.type).toEqual(notificationType);
    });

    it('should create a notification but not send email if user has email but preferences disable it', async () => {
      (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({
        userId,
        type: NotificationType.PAYMENT_RELEASED,
        emailEnabled: false,
      });
      const notificationType = NotificationType.PAYMENT_RELEASED;
      const result = await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { stellarAddress } });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { userId, type: notificationType, title, message, data },
      });
      expect(mockNodemailerSendMail).not.toHaveBeenCalled();
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.type).toEqual(notificationType);
    });

    it('should create a notification but not send email if user does not have an email', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        stellarAddress,
        email: null,
      });
      const notificationType = NotificationType.MILESTONE_UNLOCKED;
      const result = await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { stellarAddress } });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { userId, type: notificationType, title, message, data },
      });
      expect(mockNodemailerSendMail).not.toHaveBeenCalled();
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.type).toEqual(notificationType);
    });

    it('should not create a notification if no user is found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const notificationType = NotificationType.PAYMENT_RELEASED;
      const result = await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { stellarAddress } });
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mockNodemailerSendMail).not.toHaveBeenCalled();
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should handle errors during notification process', async () => {
      (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('Database error'));
      const notificationType = NotificationType.PAYMENT_RELEASED;
      const result = await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { stellarAddress } });
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mockNodemailerSendMail).not.toHaveBeenCalled();
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should use default email sender if EMAIL_FROM is not configured', async () => {
      (config.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'SMTP_HOST') return 'smtp.test.com';
        if (key === 'SMTP_PORT') return 587;
        if (key === 'SMTP_USER') return 'testuser';
        if (key === 'SMTP_PASS') return 'testpass';
        // EMAIL_FROM is intentionally omitted
        return null;
      });

      const notificationType = NotificationType.PAYMENT_RELEASED;
      await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(mockNodemailerSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'noreply@hiresettle.com',
      }));
    });

    it('should correctly select email emoji based on notification type', async () => {
      const notificationType = NotificationType.DISPUTE_RAISED;
      await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(mockNodemailerSendMail).toHaveBeenCalledWith(expect.objectContaining({
        subject: '⚠️ HireSettle — Test Notification',
      }));
    });

    it('should use a default emoji if notification type is not in the map', async () => {
      const notificationType = NotificationType.ENGAGEMENT_CANCELLED; // Assuming this is not in the map for this test
      // Temporarily override the mock to simulate a type not in the emoji map
      (prisma.notification.create as jest.Mock).mockResolvedValueOnce({
        id: 'notification_id',
        userId,
        type: notificationType,
        title,
        message,
        data,
        read: false,
        emailSent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.notifyUser(stellarAddress, notificationType, title, message, data);

      expect(mockNodemailerSendMail).toHaveBeenCalledWith(expect.objectContaining({
        subject: '❌ HireSettle — Test Notification',
      }));
    });
  });

  describe('findForUser', () => {
    it('should return paginated notifications for a user', async () => {
      const userId = 'test_user_id';
      const notifications = [{ id: 'notif1', userId, read: false }, { id: 'notif2', userId, read: true }];
      (prisma.notification.findMany as jest.Mock).mockResolvedValue(notifications);
      (prisma.notification.count as jest.Mock).mockResolvedValueOnce(2).mockResolvedValueOnce(1); // total, unreadCount

      const result = await service.findForUser(userId, false, 1, 10);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId } });
      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId, read: false } });
      expect(result.data).toEqual(notifications);
      expect(result.meta.total).toBe(2);
      expect(result.meta.unreadCount).toBe(1);
    });

    it('should return only unread notifications if unreadOnly is true', async () => {
      const userId = 'test_user_id';
      const notifications = [{ id: 'notif1', userId, read: false }];
      (prisma.notification.findMany as jest.Mock).mockResolvedValue(notifications);
      (prisma.notification.count as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(1); // total, unreadCount

      const result = await service.findForUser(userId, true, 1, 10);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(result.data).toEqual(notifications);
    });
  });

  describe('getUnreadCount', () => {
    it('should return the count of unread notifications for a user', async () => {
      const userId = 'test_user_id';
      (prisma.notification.count as jest.Mock).mockResolvedValue(5);

      const result = await service.getUnreadCount(userId);

      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId, read: false } });
      expect(result).toEqual({ unreadCount: 5 });
    });
  });

  describe('markRead', () => {
    it('should mark a single notification as read', async () => {
      const notificationId = 'notif_id';
      const userId = 'test_user_id';
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.markRead(notificationId, userId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: notificationId, userId },
        data: { read: true },
      });
      expect(result).toEqual({ count: 1 });
    });
  });

  describe('markAllRead', () => {
    it('should mark all unread notifications for a user as read', async () => {
      const userId = 'test_user_id';
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await service.markAllRead(userId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        data: { read: true },
      });
      expect(result).toEqual({ count: 3 });
    });
  });
});
