import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DataRetentionService } from './data-retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../lock/distributed-lock.service';

describe('DataRetentionService', () => {
  let service: DataRetentionService;
  let prisma: {
    notification: { deleteMany: jest.Mock };
    securityEvent: { deleteMany: jest.Mock };
    idempotencyKey: { deleteMany: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    dataDeletionRequest: { deleteMany: jest.Mock };
  };
  let config: { get: jest.Mock };
  let lock: { tryAcquireLock: jest.Mock; releaseLock: jest.Mock };

  beforeEach(async () => {
    prisma = {
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      securityEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      idempotencyKey: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      dataDeletionRequest: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    config = {
      get: jest.fn((_key: string, defaultValue?: number) => defaultValue),
    };

    lock = {
      tryAcquireLock: jest.fn().mockResolvedValue('lock-token-123'),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: DistributedLockService, useValue: lock },
      ],
    }).compile();

    service = module.get<DataRetentionService>(DataRetentionService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('enforceRetention', () => {
    it('runs all six categories with default windows and aggregates deleted counts', async () => {
      const fixedNow = new Date('2026-06-15T03:00:00.000Z');
      jest.useFakeTimers().setSystemTime(fixedNow);

      prisma.notification.deleteMany
        .mockResolvedValueOnce({ count: 12 }) // read
        .mockResolvedValueOnce({ count: 3 }); // unread
      prisma.securityEvent.deleteMany.mockResolvedValueOnce({ count: 7 });
      prisma.idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 5 });
      prisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 9 });
      prisma.dataDeletionRequest.deleteMany.mockResolvedValueOnce({ count: 2 });

      const summary = await service.enforceRetention();

      expect(summary.ranAt).toEqual(fixedNow);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.totalDeleted).toBe(38);
      expect(summary.errors).toEqual([]);
      expect(summary.categories).toEqual({
        'notifications.read': { deleted: 12, skipped: false },
        'notifications.unread': { deleted: 3, skipped: false },
        security_events: { deleted: 7, skipped: false },
        idempotency_keys: { deleted: 5, skipped: false },
        refresh_tokens: { deleted: 9, skipped: false },
        data_deletion_requests: { deleted: 2, skipped: false },
      });

      const expectedDaysAgo = (days: number) => {
        const d = new Date(fixedNow);
        d.setDate(d.getDate() - days);
        return d;
      };

      expect(prisma.notification.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { read: true, createdAt: { lt: expectedDaysAgo(90) } },
      });
      expect(prisma.notification.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { read: false, createdAt: { lt: expectedDaysAgo(365) } },
      });
      expect(prisma.securityEvent.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expectedDaysAgo(365) } },
      });
      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: fixedNow } },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expectedDaysAgo(30) },
          OR: [
            { consumedAt: { not: null } },
            { revokedAt: { not: null } },
            { expiresAt: { lt: fixedNow } },
          ],
        },
      });
      expect(prisma.dataDeletionRequest.deleteMany).toHaveBeenCalledWith({
        where: {
          processedAt: { not: null },
          requestedAt: { lt: expectedDaysAgo(365) },
        },
      });
    });

    it('uses custom retention windows from ConfigService', async () => {
      const fixedNow = new Date('2026-06-15T03:00:00.000Z');
      jest.useFakeTimers().setSystemTime(fixedNow);

      const customConfig: Record<string, number> = {
        RETENTION_NOTIFICATIONS_DAYS: 14,
        RETENTION_NOTIFICATIONS_UNREAD_DAYS: 60,
        RETENTION_SECURITY_EVENTS_DAYS: 180,
        RETENTION_IDEMPOTENCY_KEYS_DAYS: 0,
        RETENTION_REFRESH_TOKENS_DAYS: 7,
        RETENTION_DATA_DELETION_REQS_DAYS: 90,
      };
      config.get.mockImplementation(
        (key: string, defaultValue?: number) =>
          customConfig[key] ?? defaultValue,
      );

      await service.enforceRetention();

      const expectedDaysAgo = (days: number) => {
        const d = new Date(fixedNow);
        d.setDate(d.getDate() - days);
        return d;
      };

      expect(prisma.notification.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { read: true, createdAt: { lt: expectedDaysAgo(14) } },
      });
      expect(prisma.notification.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { read: false, createdAt: { lt: expectedDaysAgo(60) } },
      });
      expect(prisma.securityEvent.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expectedDaysAgo(180) } },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expectedDaysAgo(7) },
          OR: [
            { consumedAt: { not: null } },
            { revokedAt: { not: null } },
            { expiresAt: { lt: fixedNow } },
          ],
        },
      });
      expect(prisma.dataDeletionRequest.deleteMany).toHaveBeenCalledWith({
        where: {
          processedAt: { not: null },
          requestedAt: { lt: expectedDaysAgo(90) },
        },
      });
    });

    it('skips categories whose retention window is set to -1', async () => {
      config.get.mockReturnValue(-1);

      const summary = await service.enforceRetention();

      expect(summary.totalDeleted).toBe(0);
      expect(summary.errors).toEqual([]);
      expect(summary.categories).toEqual({
        'notifications.read': { deleted: 0, skipped: true },
        'notifications.unread': { deleted: 0, skipped: true },
        security_events: { deleted: 0, skipped: true },
        idempotency_keys: { deleted: 0, skipped: true },
        refresh_tokens: { deleted: 0, skipped: true },
        data_deletion_requests: { deleted: 0, skipped: true },
      });

      expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
      expect(prisma.securityEvent.deleteMany).not.toHaveBeenCalled();
      expect(prisma.idempotencyKey.deleteMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(prisma.dataDeletionRequest.deleteMany).not.toHaveBeenCalled();
    });

    it('isolates category errors and continues running remaining categories', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      prisma.notification.deleteMany
        .mockResolvedValueOnce({ count: 4 })
        .mockRejectedValueOnce(new Error('DB connection lost'));
      prisma.securityEvent.deleteMany.mockRejectedValueOnce('raw string error');
      prisma.idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 6 });
      prisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 2 });
      prisma.dataDeletionRequest.deleteMany.mockResolvedValueOnce({ count: 1 });

      const summary = await service.enforceRetention();

      expect(summary.totalDeleted).toBe(13);
      expect(summary.categories['notifications.read']).toEqual({
        deleted: 4,
        skipped: false,
      });
      expect(summary.categories['notifications.unread']).toEqual({
        deleted: 0,
        skipped: false,
        error: 'DB connection lost',
      });
      expect(summary.categories['security_events']).toEqual({
        deleted: 0,
        skipped: false,
        error: 'raw string error',
      });
      expect(summary.categories['idempotency_keys']).toEqual({
        deleted: 6,
        skipped: false,
      });
      expect(summary.errors).toEqual([
        'notifications.unread: DB connection lost',
        'security_events: raw string error',
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleScheduledRetention', () => {
    it('acquires lock, runs enforceRetention, logs summary, and releases lock', async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      config.get.mockImplementation((key: string, defaultValue?: number) =>
        key === 'RETENTION_NOTIFICATIONS_UNREAD_DAYS' ? -1 : defaultValue,
      );
      prisma.notification.deleteMany.mockResolvedValueOnce({ count: 5 });

      await service.handleScheduledRetention();

      expect(lock.tryAcquireLock).toHaveBeenCalledWith(
        'cron:data-retention',
        3_600_000,
      );
      expect(lock.releaseLock).toHaveBeenCalledWith(
        'cron:data-retention',
        'lock-token-123',
      );
      expect(logSpy).toHaveBeenCalledWith('Data retention job started');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[notifications.read] deleted 5'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[notifications.unread] skipped (disabled)'),
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs summary as warning when one or more categories fail', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      prisma.securityEvent.deleteMany.mockRejectedValueOnce(
        new Error('timeout'),
      );

      await service.handleScheduledRetention();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[security_events] ERROR — timeout'),
      );
      expect(lock.releaseLock).toHaveBeenCalledWith(
        'cron:data-retention',
        'lock-token-123',
      );
    });

    it('returns early without running or releasing lock when distributed lock is unavailable', async () => {
      lock.tryAcquireLock.mockResolvedValueOnce(null);
      const enforceSpy = jest.spyOn(service, 'enforceRetention');

      await service.handleScheduledRetention();

      expect(enforceSpy).not.toHaveBeenCalled();
      expect(lock.releaseLock).not.toHaveBeenCalled();
    });

    it('skips tick and logs warning when job is already running, then releases lock', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const enforceSpy = jest.spyOn(service, 'enforceRetention');

      (service as any).isRunning = true;

      await service.handleScheduledRetention();

      expect(warnSpy).toHaveBeenCalledWith(
        'Data retention job already running — skipping this tick',
      );
      expect(enforceSpy).not.toHaveBeenCalled();
      expect(lock.releaseLock).toHaveBeenCalledWith(
        'cron:data-retention',
        'lock-token-123',
      );
    });

    it('catches unhandled errors from enforceRetention, resets isRunning, and releases lock', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const boom = new Error('unexpected failure');

      jest.spyOn(service, 'enforceRetention').mockRejectedValueOnce(boom);

      await service.handleScheduledRetention();

      expect(errorSpy).toHaveBeenCalledWith(
        'Data retention job failed with an unhandled error',
        boom,
      );
      expect((service as any).isRunning).toBe(false);
      expect(lock.releaseLock).toHaveBeenCalledWith(
        'cron:data-retention',
        'lock-token-123',
      );
    });
  });
});
