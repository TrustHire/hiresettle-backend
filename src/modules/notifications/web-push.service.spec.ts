import { ConfigService } from '@nestjs/config';
import { Notification, NotificationType } from '@prisma/client';
import * as webpush from 'web-push';
import { WebPushService } from './web-push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const mockSend = webpush.sendNotification as jest.Mock;

describe('WebPushService', () => {
  const prisma = {
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const notification = {
    id: 'notif-1',
    userId: 'user-1',
    type: NotificationType.PAYMENT_RELEASED,
    title: 'Payment released',
    message: 'Payment of 100 USDC released.',
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
  } as Notification;

  const sub = { id: 'sub-1', endpoint: 'https://push.example.com/abc', p256dh: 'p', auth: 'a' };

  const build = (env: Record<string, string> = {}) => {
    const service = new WebPushService(prisma as any, new ConfigService(env));
    service.onModuleInit();
    return service;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pushSubscription.findMany.mockResolvedValue([sub]);
  });

  const vapidEnv = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };

  it('is a no-op when VAPID keys are not configured', async () => {
    const service = build();
    await service.sendNotification(notification);
    expect(service.isConfigured()).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(() => service.getPublicKey()).toThrow('Web push is not configured');
  });

  it('pushes the notification to each subscription', async () => {
    mockSend.mockResolvedValue({ statusCode: 201 });
    const service = build(vapidEnv);

    await service.sendNotification(notification);

    expect(webpush.setVapidDetails).toHaveBeenCalledWith('mailto:noreply@hiresettle.com', 'pub', 'priv');
    expect(mockSend).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      expect.stringContaining('"title":"Payment released"'),
      expect.objectContaining({ TTL: expect.any(Number) }),
    );
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: sub.id },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it.each([404, 410])('removes subscriptions the push service reports as gone (%i)', async (statusCode) => {
    mockSend.mockRejectedValue(Object.assign(new Error('gone'), { statusCode }));
    const service = build(vapidEnv);

    await service.sendNotification(notification);

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: sub.id } });
  });

  it('keeps subscriptions on transient errors', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('server error'), { statusCode: 500 }));
    const service = build(vapidEnv);

    await expect(service.sendNotification(notification)).resolves.toBeUndefined();
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('upserts subscriptions by endpoint', async () => {
    prisma.pushSubscription.upsert.mockResolvedValue({ id: 'sub-1', endpoint: sub.endpoint, createdAt: new Date() });
    const service = build(vapidEnv);

    await service.subscribe('user-1', { endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } });

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endpoint: sub.endpoint } }),
    );
  });

  it('only unsubscribes endpoints owned by the user', async () => {
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    const service = build(vapidEnv);

    const result = await service.unsubscribe('user-1', sub.endpoint);

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', endpoint: sub.endpoint },
    });
    expect(result).toEqual({ success: true });
  });
});
