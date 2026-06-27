import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { NotificationType } from '@prisma/client';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: NotificationsService;

  const mockNotificationsService = {
    findForUser: jest.fn(),
    getUnreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    addConnection: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserJwtSubThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return a paginated list of notifications', async () => {
      const userId = 'user123';
      const notifications = [
        { id: 'notif1', userId, type: NotificationType.PAYMENT_RELEASED, title: 'Test', message: 'Msg', data: {}, read: false, emailSent: false, createdAt: new Date(), updatedAt: new Date() },
      ];
      const meta = { total: 1, page: 1, limit: 10, unreadCount: 1 };
      mockNotificationsService.findForUser.mockResolvedValue({ data: notifications, meta });

      const result = await controller.findAll(userId, false, 1, 10);

      expect(service.findForUser).toHaveBeenCalledWith(userId, false, 1, 10);
      expect(result).toEqual({ data: notifications, meta });
    });
  });

  describe('getUnreadCount', () => {
    it('should return the unread count', async () => {
      const userId = 'user123';
      mockNotificationsService.getUnreadCount.mockResolvedValue({ unreadCount: 5 });

      const result = await controller.getUnreadCount(userId);

      expect(service.getUnreadCount).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ unreadCount: 5 });
    });
  });

  describe('markRead', () => {
    it('should mark a notification as read', async () => {
      const userId = 'user123';
      const notificationId = 'notif1';
      mockNotificationsService.markRead.mockResolvedValue({ count: 1 });

      const result = await controller.markRead(notificationId, userId);

      expect(service.markRead).toHaveBeenCalledWith(notificationId, userId);
      expect(result).toEqual({ count: 1 });
    });
  });

  describe('markAllRead', () => {
    it('should mark all notifications as read', async () => {
      const userId = 'user123';
      mockNotificationsService.markAllRead.mockResolvedValue({ count: 3 });

      const result = await controller.markAllRead(userId);

      expect(service.markAllRead).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('streamNotifications', () => {
    it('should add a connection for SSE', async () => {
      const userId = 'user123';
      const mockResponse = {
        writeHead: jest.fn(),
        write: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === 'close') {
            // Simulate connection close after some time
            setTimeout(cb, 100);
          }
        }),
      } as any;

      await controller.streamNotifications(userId, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      expect(mockResponse.write).toHaveBeenCalledWith(': keep-alive\n\n');
      expect(service.addConnection).toHaveBeenCalledWith(userId, mockResponse);
    });
  });
});
