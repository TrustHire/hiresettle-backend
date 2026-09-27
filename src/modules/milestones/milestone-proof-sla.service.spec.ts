import { Test, TestingModule } from '@nestjs/testing';
import { MilestoneStatus, ProofSlaAction, ProofVersionStatus } from '@prisma/client';
import { MilestoneProofSlaService } from './milestone-proof-sla.service';
import { MilestonesService } from './milestones.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY = 24 * 60 * 60 * 1000;
const SUBMITTED_AT = new Date('2026-09-01T00:00:00.000Z');
const daysAfter = (days: number) => new Date(SUBMITTED_AT.getTime() + days * DAY);

const pendingVersion = (
  overrides: Record<string, unknown> = {},
  company: { proofSlaDays: number; proofSlaAction: ProofSlaAction } = {
    proofSlaDays: 10,
    proofSlaAction: ProofSlaAction.ESCALATE_TO_ADMIN,
  },
) => ({
  id: 'pv-1',
  versionNumber: 1,
  status: ProofVersionStatus.SUBMITTED,
  submittedAt: SUBMITTED_AT,
  reminder50SentAt: null,
  reminder90SentAt: null,
  slaExpiredAt: null,
  milestone: {
    id: 'ms-0',
    engagementId: 'ENG-001',
    milestoneIndex: 0,
    amount: 1_500_000_000n,
    status: MilestoneStatus.PROOF_SUBMITTED,
    engagement: {
      companyAddress: 'GCOMPANY',
      recruiterAddress: 'GRECRUITER',
      company: { id: 'company-1', ...company },
    },
  },
  ...overrides,
});

describe('MilestoneProofSlaService', () => {
  let service: MilestoneProofSlaService;
  let prisma: any;
  const stellar = { releaseMilestonePayment: jest.fn() };
  const notifications = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyUserById: jest.fn().mockResolvedValue(undefined),
  };
  const milestones = { markConfirmed: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    jest.clearAllMocks();
    stellar.releaseMilestonePayment.mockResolvedValue('tx-release');
    prisma = {
      milestoneProofVersion: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestoneProofSlaService,
        { provide: PrismaService, useValue: prisma },
        { provide: StellarService, useValue: stellar },
        { provide: NotificationsService, useValue: notifications },
        { provide: MilestonesService, useValue: milestones },
      ],
    }).compile();
    service = module.get(MilestoneProofSlaService);
  });

  it('only scans pending proof on milestones still awaiting review', async () => {
    prisma.milestoneProofVersion.findMany.mockResolvedValue([]);
    await service.runProofSlaChecks(daysAfter(1));
    expect(prisma.milestoneProofVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProofVersionStatus.SUBMITTED,
          slaExpiredAt: null,
          milestone: { status: MilestoneStatus.PROOF_SUBMITTED },
        },
      }),
    );
  });

  describe('reminders', () => {
    it('does nothing before 50% of the window', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion()]);

      const summary = await service.runProofSlaChecks(daysAfter(4.9));

      expect(summary).toEqual({ reminders50: 0, reminders90: 0, autoApproved: 0, escalated: 0 });
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('sends the 50% reminder once', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion()]);

      const summary = await service.runProofSlaChecks(daysAfter(5));

      expect(summary.reminders50).toBe(1);
      expect(prisma.milestoneProofVersion.updateMany).toHaveBeenCalledWith({
        where: { id: 'pv-1', status: ProofVersionStatus.SUBMITTED, reminder50SentAt: null },
        data: { reminder50SentAt: daysAfter(5) },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GCOMPANY',
        'PROOF_REVIEW_REMINDER',
        'Proof awaiting your review',
        expect.stringContaining('50% of the 10-day review window'),
        expect.objectContaining({ percent: 50, deadline: daysAfter(10) }),
      );
    });

    it('does not resend the 50% reminder', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion({ reminder50SentAt: daysAfter(5) })]);

      const summary = await service.runProofSlaChecks(daysAfter(6));

      expect(summary.reminders50).toBe(0);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('sends the 90% reminder at 90% of the window', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion({ reminder50SentAt: daysAfter(5) })]);

      const summary = await service.runProofSlaChecks(daysAfter(9));

      expect(summary.reminders90).toBe(1);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GCOMPANY',
        'PROOF_REVIEW_REMINDER',
        'Proof review deadline is close',
        expect.stringContaining('90%'),
        expect.objectContaining({ percent: 90 }),
      );
    });

    it('after downtime past 90%, sends a single 90% reminder and marks 50% as covered', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion()]);

      const summary = await service.runProofSlaChecks(daysAfter(9.5));

      expect(summary).toMatchObject({ reminders50: 0, reminders90: 1 });
      expect(prisma.milestoneProofVersion.updateMany).toHaveBeenCalledWith({
        where: { id: 'pv-1', status: ProofVersionStatus.SUBMITTED, reminder90SentAt: null },
        data: { reminder90SentAt: daysAfter(9.5), reminder50SentAt: daysAfter(9.5) },
      });
      expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('honours each company SLA length (default 7 days)', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([
        pendingVersion({}, { proofSlaDays: 7, proofSlaAction: ProofSlaAction.ESCALATE_TO_ADMIN }),
      ]);

      const summary = await service.runProofSlaChecks(daysAfter(3.5));

      expect(summary.reminders50).toBe(1);
    });

    it('skips a reminder another run already claimed', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion()]);
      prisma.milestoneProofVersion.updateMany.mockResolvedValue({ count: 0 });

      const summary = await service.runProofSlaChecks(daysAfter(5));

      expect(summary.reminders50).toBe(0);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('on expiry', () => {
    it('AUTO_APPROVE releases payment on-chain, confirms the milestone and approves the version', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([
        pendingVersion({}, { proofSlaDays: 10, proofSlaAction: ProofSlaAction.AUTO_APPROVE }),
      ]);

      const summary = await service.runProofSlaChecks(daysAfter(10));

      expect(summary.autoApproved).toBe(1);
      expect(prisma.milestoneProofVersion.updateMany).toHaveBeenCalledWith({
        where: { id: 'pv-1', status: ProofVersionStatus.SUBMITTED, slaExpiredAt: null },
        data: { slaExpiredAt: daysAfter(10) },
      });
      expect(stellar.releaseMilestonePayment).toHaveBeenCalledWith('ENG-001', 0);
      expect(milestones.markConfirmed).toHaveBeenCalledWith('ENG-001', 0, 1_500_000_000n);
      expect(prisma.milestoneProofVersion.update).toHaveBeenCalledWith({
        where: { id: 'pv-1' },
        data: { status: ProofVersionStatus.APPROVED, reviewedAt: daysAfter(10), reviewedById: null },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GRECRUITER',
        'PAYMENT_RELEASED',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ autoApproved: true }),
      );
      expect(notifications.notifyUserById).not.toHaveBeenCalled();
    });

    it('AUTO_APPROVE releases the claim when the chain call fails so the next run retries', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([
        pendingVersion({}, { proofSlaDays: 10, proofSlaAction: ProofSlaAction.AUTO_APPROVE }),
      ]);
      stellar.releaseMilestonePayment.mockRejectedValue(new Error('tx rejected'));

      const summary = await service.runProofSlaChecks(daysAfter(11));

      expect(summary.autoApproved).toBe(0);
      expect(prisma.milestoneProofVersion.update).toHaveBeenCalledWith({ where: { id: 'pv-1' }, data: { slaExpiredAt: null } });
      expect(milestones.markConfirmed).not.toHaveBeenCalled();
    });

    it('ESCALATE_TO_ADMIN notifies every admin and the company, without moving funds', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion()]);

      const summary = await service.runProofSlaChecks(daysAfter(12));

      expect(summary.escalated).toBe(1);
      expect(stellar.releaseMilestonePayment).not.toHaveBeenCalled();
      expect(notifications.notifyUserById).toHaveBeenCalledTimes(2);
      expect(notifications.notifyUserById).toHaveBeenCalledWith(
        'admin-1',
        'PROOF_SLA_ESCALATED',
        'Proof review SLA breached',
        expect.stringContaining('more than 10 days'),
        expect.objectContaining({ milestoneId: 'ms-0', versionNumber: 1 }),
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'GCOMPANY',
        'PROOF_SLA_ESCALATED',
        'Proof review escalated',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('never runs the expiry action twice', async () => {
      prisma.milestoneProofVersion.findMany.mockResolvedValue([pendingVersion()]);
      prisma.milestoneProofVersion.updateMany.mockResolvedValue({ count: 0 });

      const summary = await service.runProofSlaChecks(daysAfter(12));

      expect(summary.escalated).toBe(0);
      expect(notifications.notifyUserById).not.toHaveBeenCalled();
    });
  });

  it('keeps processing other versions when one fails', async () => {
    prisma.milestoneProofVersion.findMany.mockResolvedValue([
      pendingVersion({ id: 'pv-bad' }),
      pendingVersion({ id: 'pv-good' }),
    ]);
    notifications.notifyUser.mockRejectedValueOnce(new Error('smtp down'));

    const summary = await service.runProofSlaChecks(daysAfter(5));

    expect(summary.reminders50).toBe(1);
  });
});
