import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WeeklyDigestService } from './weekly-digest.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';

describe('WeeklyDigestService', () => {
  let service: WeeklyDigestService;
  let prisma: PrismaService;
  let notifications: NotificationsService;

  const optedInUsers = [
    { id: 'u1', email: 'one@example.com', name: 'Alice' },
    { id: 'u2', email: 'two@example.com', name: 'Bob' },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyDigestService,
        {
          provide: PrismaService,
          useValue: {
            user: { findMany: jest.fn() },
            notification: { findMany: jest.fn() },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'DIGEST_WINDOW_DAYS') return 7;
              return null;
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: { sendDigestEmail: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<WeeklyDigestService>(WeeklyDigestService);
    prisma = module.get<PrismaService>(PrismaService);
    notifications = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('only considers opted-in users with an email, not deleted/deactivated', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    await service.runWeeklyDigest(new Date());

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          digestEnabled: true,
          email: { not: null },
          deletedAt: null,
          deactivatedAt: null,
        },
      }),
    );
  });

  it('sends a digest summarizing the prior 7 days for opted-in users with activity', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue(optedInUsers);
    (prisma.notification.findMany as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(
        where.userId === 'u1'
          ? [
              {
                id: 'n1',
                type: NotificationType.PAYMENT_RELEASED,
                title: 'Payment released',
                message: 'Your payment of 100 USDC was released.',
                createdAt: new Date('2026-08-24T10:00:00Z'),
              },
            ]
          : [],
      ),
    );

    const result = await service.runWeeklyDigest(new Date('2026-08-31T09:00:00Z'));

    expect(notifications.sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(notifications.sendDigestEmail).toHaveBeenCalledWith(
      'one@example.com',
      'Your weekly HireSettle digest',
      expect.stringContaining('Your payment of 100 USDC was released.'),
    );
    expect(result).toEqual(
      expect.objectContaining({ optedIn: 2, sent: 1, skippedEmpty: 1, errors: 0 }),
    );
  });

  it('does not send an email to users with no activity in the period', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue(optedInUsers);
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.runWeeklyDigest(new Date());

    expect(notifications.sendDigestEmail).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ optedIn: 2, sent: 0, skippedEmpty: 2, errors: 0 }),
    );
  });

  it('continues the batch when one user fails and reports the error', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue(optedInUsers);
    (prisma.notification.findMany as jest.Mock).mockImplementation(({ where }) =>
      where.userId === 'u1'
        ? Promise.reject(new Error('db timeout'))
        : Promise.resolve([
            {
              id: 'n2',
              type: NotificationType.ENGAGEMENT_CREATED,
              title: 'New engagement',
              message: 'An engagement was created.',
              createdAt: new Date('2026-08-25T10:00:00Z'),
            },
          ]),
    );

    const result = await service.runWeeklyDigest(new Date());

    expect(notifications.sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(notifications.sendDigestEmail).toHaveBeenCalledWith(
      'two@example.com',
      'Your weekly HireSettle digest',
      expect.stringContaining('An engagement was created.'),
    );
    expect(result).toEqual(
      expect.objectContaining({ optedIn: 2, sent: 1, skippedEmpty: 0, errors: 1 }),
    );
  });

  it('escapes user-provided content in the digest HTML', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'u1', email: 'one@example.com', name: '<script>alert(1)</script>' },
    ]);
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'n1',
        type: NotificationType.MILESTONE_UNLOCKED,
        title: 'Milestone <b>unlocked</b>',
        message: 'Message with <script> tag',
        createdAt: new Date('2026-08-24T10:00:00Z'),
      },
    ]);

    await service.runWeeklyDigest(new Date());

    const html = (notifications.sendDigestEmail as jest.Mock).mock.calls[0][2] as string;
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});
