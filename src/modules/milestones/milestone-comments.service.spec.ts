import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MilestoneCommentsService } from './milestone-comments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const engagement = {
  id: 'ENG-001',
  companyId: 'company-1',
  recruiterId: 'recruiter-1',
  arbiterId: null,
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
  arbiterAddress: 'GARBITER',
};
const company = { id: 'company-1', role: 'COMPANY', stellarAddress: 'GCOMPANY' };
const recruiter = { id: 'recruiter-1', role: 'RECRUITER', stellarAddress: 'GRECRUITER' };
const arbiter = { id: 'arbiter-1', role: 'ARBITER', stellarAddress: 'GARBITER' };

const comment = (n: number) => ({ id: `c-${n}`, body: `comment ${n}`, createdAt: new Date(2026, 8, n) });

describe('MilestoneCommentsService', () => {
  let service: MilestoneCommentsService;
  let prisma: any;
  const notifications = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyUserById: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      milestone: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ms-0', engagementId: 'ENG-001', milestoneIndex: 0, engagement }),
      },
      milestoneComment: {
        create: jest.fn(async ({ data }) => ({ id: 'c-new', ...data, author: { id: data.authorId, name: 'Ada', role: 'COMPANY' } })),
        findMany: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestoneCommentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(MilestoneCommentsService);
  });

  describe('authorization', () => {
    it.each([
      ['company', company],
      ['recruiter', recruiter],
      ['arbiter (matched by wallet)', arbiter],
    ])('allows the %s', async (_label, user) => {
      await expect(service.create('ENG-001', 0, user, 'hello')).resolves.toBeDefined();
      prisma.milestoneComment.findMany.mockResolvedValue([]);
      await expect(service.list('ENG-001', 0, user)).resolves.toBeDefined();
    });

    it.each([
      ['an outsider', { id: 'someone', role: 'COMPANY', stellarAddress: 'GOTHER' }],
      ['an admin who is not a participant', { id: 'admin-1', role: 'ADMIN' }],
    ])('rejects %s', async (_label, user) => {
      await expect(service.create('ENG-001', 0, user, 'hi')).rejects.toThrow(ForbiddenException);
      await expect(service.list('ENG-001', 0, user)).rejects.toThrow(ForbiddenException);
      expect(prisma.milestoneComment.create).not.toHaveBeenCalled();
    });

    it('404s for an unknown milestone', async () => {
      prisma.milestone.findUnique.mockResolvedValue(null);
      await expect(service.create('ENG-001', 9, company, 'hi')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create()', () => {
    it('stores the comment against the milestone and engagement', async () => {
      await service.create('ENG-001', 0, company, 'Can you share the signed contract?');

      expect(prisma.milestoneComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { milestoneId: 'ms-0', engagementId: 'ENG-001', authorId: 'company-1', body: 'Can you share the signed contract?' },
        }),
      );
    });

    it('notifies every participant except the author', async () => {
      await service.create('ENG-001', 0, company, 'Please update the proof');

      // recruiter has a user id; arbiter is only known by wallet on this engagement
      expect(notifications.notifyUserById).toHaveBeenCalledTimes(1);
      expect(notifications.notifyUserById).toHaveBeenCalledWith(
        'recruiter-1',
        'MILESTONE_COMMENT_ADDED',
        'New comment on milestone 0',
        expect.stringContaining('Please update the proof'),
        expect.objectContaining({ commentId: 'c-new', engagementId: 'ENG-001', milestoneIndex: 0 }),
      );
      expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GARBITER',
        'MILESTONE_COMMENT_ADDED',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('truncates long comments in the notification preview', async () => {
      await service.create('ENG-001', 0, recruiter, 'x'.repeat(500));
      const message: string = notifications.notifyUserById.mock.calls[0][3];
      expect(message).toContain(`${'x'.repeat(137)}...`);
      expect(message).not.toContain('x'.repeat(141));
    });
  });

  describe('recipients()', () => {
    it('recognises the author by wallet as well as id', () => {
      const recipients = MilestoneCommentsService.recipients(engagement, { stellarAddress: 'GRECRUITER' });
      expect(recipients.map((r) => r.id ?? r.address)).toEqual(['company-1', 'GARBITER']);
    });
  });

  describe('list() — pagination', () => {
    it('returns the first page oldest-first with a cursor when more exist', async () => {
      prisma.milestoneComment.findMany.mockResolvedValue([comment(1), comment(2), comment(3)]);

      const page = await service.list('ENG-001', 0, company, { limit: 2 });

      expect(prisma.milestoneComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { milestoneId: 'ms-0' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 3,
        }),
      );
      expect(page.data.map((c) => c.id)).toEqual(['c-1', 'c-2']);
      expect(page.nextCursor).toBe('c-2');
    });

    it('continues after the cursor', async () => {
      prisma.milestoneComment.findMany.mockResolvedValue([comment(3)]);

      const page = await service.list('ENG-001', 0, company, { limit: 2, cursor: 'c-2' });

      expect(prisma.milestoneComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'c-2' }, skip: 1 }),
      );
      expect(page.nextCursor).toBeNull();
    });

    it('clamps the page size to 100', async () => {
      prisma.milestoneComment.findMany.mockResolvedValue([]);
      await service.list('ENG-001', 0, company, { limit: 1000 });
      expect(prisma.milestoneComment.findMany.mock.calls[0][0].take).toBe(101);
    });
  });
});
