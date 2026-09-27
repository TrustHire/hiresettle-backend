import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivityFeedService } from './activity-feed.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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
const at = (day: number) => new Date(Date.UTC(2026, 8, day));

describe('ActivityFeedService', () => {
  let service: ActivityFeedService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      engagement: { findUnique: jest.fn().mockResolvedValue(engagement) },
      engagementAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', createdAt: at(1), changedBy: 'company-1', fromStatus: 'PENDING_ACCEPTANCE', toStatus: 'ACTIVE', reason: null },
        ]),
      },
      engagementNote: {
        findMany: jest.fn().mockResolvedValue([{ id: 'n1', createdAt: at(2), authorId: 'recruiter-1', body: 'kick-off' }]),
      },
      milestoneAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            createdAt: at(6),
            changedBy: 'recruiter-1',
            fromStatus: 'PROOF_SUBMITTED',
            toStatus: 'CONFIRMED',
            action: 'PARTIAL_RELEASE_EXECUTED',
            details: { txHash: 'tx-1' },
            milestone: { milestoneIndex: 0 },
          },
        ]),
      },
      milestoneProofVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            submittedAt: at(3),
            submittedById: 'recruiter-1',
            versionNumber: 1,
            status: 'REJECTED',
            rejectionReason: 'unsigned',
            milestone: { milestoneIndex: 0 },
          },
        ]),
      },
      milestonePartialRelease: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'r1',
            createdAt: at(5),
            proposedById: 'company-1',
            status: 'EXECUTED',
            releaseAmount: 600n,
            remainderAmount: 400n,
            remainderAction: 'REFUND',
            txHash: 'tx-1',
            milestone: { milestoneIndex: 0 },
          },
        ]),
      },
      milestoneComment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            createdAt: at(4),
            authorId: 'company-1',
            body: 'Please re-sign',
            milestone: { milestoneIndex: 0 },
            author: { id: 'company-1', name: 'Ada', role: 'COMPANY' },
          },
        ]),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivityFeedService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ActivityFeedService);
  });

  it('aggregates all sources, including milestone comments, newest first', async () => {
    const { items, nextCursor } = await service.getActivity('ENG-001', company);

    expect(items.map((i) => i.id)).toEqual([
      'milestone_audit:m1',
      'partial_release:r1',
      'milestone_comment:c1',
      'proof_version:p1',
      'note:n1',
      'status_change:a1',
    ]);
    expect(nextCursor).toBeNull();

    const commentItem = items.find((i) => i.type === 'milestone_comment')!;
    expect(commentItem).toMatchObject({
      actorId: 'company-1',
      milestoneIndex: 0,
      data: { body: 'Please re-sign', author: { name: 'Ada' } },
    });
    expect(items.find((i) => i.type === 'partial_release')!.data).toMatchObject({ releaseAmount: '600', txHash: 'tx-1' });
  });

  it('scopes milestone-level sources to the engagement', async () => {
    await service.getActivity('ENG-001', company);
    expect(prisma.milestoneComment.findMany.mock.calls[0][0].where).toEqual({ engagementId: 'ENG-001' });
    expect(prisma.milestoneAuditLog.findMany.mock.calls[0][0].where).toEqual({ milestone: { engagementId: 'ENG-001' } });
    expect(prisma.milestoneProofVersion.findMany.mock.calls[0][0].where).toEqual({ milestone: { engagementId: 'ENG-001' } });
  });

  it('paginates with a keyset cursor', async () => {
    const first = await service.getActivity('ENG-001', company, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['milestone_audit:m1', 'partial_release:r1']);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.getActivity('ENG-001', company, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((i) => i.id)).toEqual(['milestone_comment:c1', 'proof_version:p1']);
    expect(prisma.milestoneComment.findMany.mock.calls[1][0].where).toEqual({
      engagementId: 'ENG-001',
      createdAt: { lte: at(5) },
    });
    expect(prisma.milestoneProofVersion.findMany.mock.calls[1][0].where).toEqual({
      milestone: { engagementId: 'ENG-001' },
      submittedAt: { lte: at(5) },
    });
  });

  it('rejects a malformed cursor', async () => {
    await expect(service.getActivity('ENG-001', company, { cursor: 'garbage' })).rejects.toThrow(BadRequestException);
  });

  it('is restricted to participants and admins', async () => {
    await expect(service.getActivity('ENG-001', { id: 'x', role: 'RECRUITER', stellarAddress: 'GX' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getActivity('ENG-001', { id: 'admin', role: 'ADMIN' })).resolves.toBeDefined();
  });

  it('404s for unknown engagements', async () => {
    prisma.engagement.findUnique.mockResolvedValue(null);
    await expect(service.getActivity('nope', company)).rejects.toThrow(NotFoundException);
  });

  it('orders equal timestamps deterministically by id', () => {
    const items = [
      { id: 'note:a', timestamp: at(1) },
      { id: 'note:b', timestamp: at(1) },
    ];
    expect([...items].sort(ActivityFeedService.compare).map((i) => i.id)).toEqual(['note:b', 'note:a']);
  });
});
