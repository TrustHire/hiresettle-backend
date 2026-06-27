import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { MilestonesService } from '../milestones/milestones.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EngagementsService } from '../engagements/engagements.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationType } from '@prisma/client';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: PrismaService;
  let stellar: StellarService;
  let milestones: MilestonesService;
  let notifications: NotificationsService;
  let engagements: EngagementsService;
  let webhooks: WebhooksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: PrismaService,
          useValue: {
            chainEvent: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
            },
            user: {
              findFirst: jest.fn(),
            },
            engagement: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            retentionSchedule: {
              updateMany: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(prisma)),
          },
        },
        {
          provide: StellarService,
          useValue: {
            getLatestLedger: jest.fn(),
            fetchContractEvents: jest.fn(),
            stroopsToUsdc: jest.fn(),
          },
        },
        {
          provide: MilestonesService,
          useValue: {
            markUnlocked: jest.fn(),
            markProofSubmitted: jest.fn(),
            markConfirmed: jest.fn(),
            markDisputed: jest.fn(),
            markResolved: jest.fn(),
            resetForReplacement: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyUser: jest.fn(),
          },
        },
        {
          provide: EngagementsService,
          useValue: {
            syncFromChain: jest.fn(),
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            sendWebhook: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    prisma = module.get<PrismaService>(PrismaService);
    stellar = module.get<StellarService>(StellarService);
    milestones = module.get<MilestonesService>(MilestonesService);
    notifications = module.get<NotificationsService>(NotificationsService);
    engagements = module.get<EngagementsService>(EngagementsService);
    webhooks = module.get<WebhooksService>(WebhooksService);

    // Mock onModuleInit to prevent it from running during tests
    jest.spyOn(service, 'onModuleInit').mockImplementation(async () => {
      (stellar.getLatestLedger as jest.Mock).mockResolvedValue(100);
      // @ts-ignore
      service.lastProcessedLedger = 100;
    });

    // Call onModuleInit manually if needed for specific tests
    // await service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Add tests for each event handler here

  describe('handleEngagementCreated', () => {
    it('should call engagements.syncFromChain with the correct engagementId', async () => {
      const engagementId = 'testEngagementId';
      const payload = engagementId;
      
      // @ts-ignore
      await service.handleEngagementCreated(payload, prisma);

      expect(engagements.syncFromChain).toHaveBeenCalledWith(engagementId);
    });
  });

  describe('handleMilestoneUnlocked', () => {
    it('should mark milestone as unlocked, update retention schedule, and notify recruiter', async () => {
      const engagementId = 'testEngagementId';
      const milestoneIndex = 1;
      const payload = [engagementId, milestoneIndex];
      const recruiterAddress = 'recruiterAddress';

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        recruiterAddress,
      });

      // @ts-ignore
      await service.handleMilestoneUnlocked(payload, prisma);

      expect(milestones.markUnlocked).toHaveBeenCalledWith(engagementId, milestoneIndex);
      expect(prisma.retentionSchedule.updateMany).toHaveBeenCalledWith({
        where: { engagementId, milestoneIndex },
        data: { unlocked: true },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.MILESTONE_UNLOCKED,
        'Retention milestone unlocked',
        `Milestone ${milestoneIndex} for engagement ${engagementId} is now available. Submit your proof to claim payment.`,
        { engagementId, milestoneIndex },
      );
    });
  });

  describe('handleProofSubmitted', () => {
    it('should mark proof as submitted and notify company', async () => {
      const engagementId = 'testEngagementId';
      const milestoneIndex = 1;
      const payload = [engagementId, milestoneIndex];
      const companyAddress = 'companyAddress';

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        companyAddress,
      });

      // @ts-ignore
      await service.handleProofSubmitted(payload, prisma);

      expect(milestones.markProofSubmitted).toHaveBeenCalledWith(engagementId, milestoneIndex, '');
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        companyAddress,
        NotificationType.PROOF_SUBMITTED,
        'Proof submitted — action required',
        `Milestone ${milestoneIndex} proof has been submitted for engagement ${engagementId}. Please review and confirm or dispute.`,
        { engagementId, milestoneIndex },
      );
    });
  });

  describe('handleMilestoneConfirmed', () => {
    it('should mark milestone as confirmed, sync engagement, notify recruiter, and dispatch webhook', async () => {
      const engagementId = 'testEngagementId';
      const milestoneIndex = 1;
      const paymentAmount = '10000000'; // 10 USDC in stroops
      const payload = [engagementId, milestoneIndex, paymentAmount];
      const recruiterAddress = 'recruiterAddress';
      const companyAddress = 'companyAddress';
      const usdcAmount = 10;

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        recruiterAddress,
        companyAddress,
        status: 'COMPLETED',
      });
      (stellar.stroopsToUsdc as jest.Mock).mockReturnValue(usdcAmount);

      // @ts-ignore
      await service.handleMilestoneConfirmed(payload, prisma);

      expect(milestones.markConfirmed).toHaveBeenCalledWith(
        engagementId,
        milestoneIndex,
        BigInt(paymentAmount),
      );
      expect(engagements.syncFromChain).toHaveBeenCalledWith(engagementId);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.PAYMENT_RELEASED,
        'Payment released',
        `$${usdcAmount} USDC has been released for milestone ${milestoneIndex} on engagement ${engagementId}.`,
        { engagementId, milestoneIndex, amount: usdcAmount },
      );
      expect(webhooks.sendWebhook).toHaveBeenCalledWith(undefined, {
        event: 'PAYMENT_RELEASED',
        engagementId,
        status: 'COMPLETED',
        timestamp: expect.any(String),
      });
    });
  });

  describe('handleDisputeRaised', () => {
    it('should mark milestone as disputed, notify recruiter and arbiter, and dispatch webhook', async () => {
      const engagementId = 'testEngagementId';
      const milestoneIndex = 1;
      const payload = [engagementId, milestoneIndex];
      const recruiterAddress = 'recruiterAddress';
      const arbiterAddress = 'arbiterAddress';
      const companyAddress = 'companyAddress';

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        recruiterAddress,
        arbiterAddress,
        companyAddress,
        status: 'DISPUTED',
      });

      // @ts-ignore
      await service.handleDisputeRaised(payload, prisma);

      expect(milestones.markDisputed).toHaveBeenCalledWith(engagementId, milestoneIndex);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.DISPUTE_RAISED,
        'Dispute raised',
        `A dispute has been raised on milestone ${milestoneIndex} for engagement ${engagementId}.`,
        { engagementId, milestoneIndex },
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        arbiterAddress,
        NotificationType.DISPUTE_RAISED,
        'Dispute raised',
        `A dispute has been raised on milestone ${milestoneIndex} for engagement ${engagementId}.`,
        { engagementId, milestoneIndex },
      );
      expect(webhooks.sendWebhook).toHaveBeenCalledWith(undefined, {
        event: 'DISPUTE_RAISED',
        engagementId,
        status: 'DISPUTED',
        timestamp: expect.any(String),
      });
    });
  });

  describe('handleDisputeResolved', () => {
    it('should mark milestone as resolved, sync engagement, notify company and recruiter, and dispatch webhook for approved dispute', async () => {
      const engagementId = 'testEngagementId';
      const milestoneIndex = 1;
      const approved = true;
      const payload = [engagementId, milestoneIndex, approved];
      const companyAddress = 'companyAddress';
      const recruiterAddress = 'recruiterAddress';

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        companyAddress,
        recruiterAddress,
        status: 'COMPLETED',
      });

      // @ts-ignore
      await service.handleDisputeResolved(payload, prisma);

      expect(milestones.markResolved).toHaveBeenCalledWith(engagementId, milestoneIndex, approved);
      expect(engagements.syncFromChain).toHaveBeenCalledWith(engagementId);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        companyAddress,
        NotificationType.DISPUTE_RESOLVED,
        'Dispute approved',
        `The dispute on milestone ${milestoneIndex} (${engagementId}) was approved — payment released.`,
        { engagementId, milestoneIndex, approved },
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.DISPUTE_RESOLVED,
        'Dispute approved',
        `The dispute on milestone ${milestoneIndex} (${engagementId}) was approved — payment released.`,
        { engagementId, milestoneIndex, approved },
      );
      expect(webhooks.sendWebhook).toHaveBeenCalledWith(undefined, {
        event: 'COMPLETED',
        engagementId,
        status: 'COMPLETED',
        timestamp: expect.any(String),
      });
    });

    it('should mark milestone as resolved, sync engagement, notify company and recruiter, and dispatch webhook for rejected dispute', async () => {
      const engagementId = 'testEngagementId';
      const milestoneIndex = 1;
      const approved = false;
      const payload = [engagementId, milestoneIndex, approved];
      const companyAddress = 'companyAddress';
      const recruiterAddress = 'recruiterAddress';

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        companyAddress,
        recruiterAddress,
        status: 'IN_PROGRESS',
      });

      // @ts-ignore
      await service.handleDisputeResolved(payload, prisma);

      expect(milestones.markResolved).toHaveBeenCalledWith(engagementId, milestoneIndex, approved);
      expect(engagements.syncFromChain).toHaveBeenCalledWith(engagementId);
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        companyAddress,
        NotificationType.DISPUTE_RESOLVED,
        'Dispute rejected',
        `The dispute on milestone ${milestoneIndex} (${engagementId}) was rejected — recruiter must resubmit proof.`,
        { engagementId, milestoneIndex, approved },
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.DISPUTE_RESOLVED,
        'Dispute rejected',
        `The dispute on milestone ${milestoneIndex} (${engagementId}) was rejected — recruiter must resubmit proof.`,
        { engagementId, milestoneIndex, approved },
      );
      expect(webhooks.sendWebhook).toHaveBeenCalledWith(undefined, {
        event: 'PAYMENT_RELEASED',
        engagementId,
        status: 'IN_PROGRESS',
        timestamp: expect.any(String),
      });
    });
  });

  describe('handleReplacementRequested', () => {
    it('should reset milestones for replacement, update engagement status, notify recruiter, and dispatch webhook', async () => {
      const engagementId = 'testEngagementId';
      const payload = engagementId;
      const recruiterAddress = 'recruiterAddress';
      const companyAddress = 'companyAddress';
      const currentLedger = 100;

      (stellar.getLatestLedger as jest.Mock).mockResolvedValue(currentLedger);
      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        recruiterAddress,
        companyAddress,
        status: 'IN_PROGRESS',
      });

      // @ts-ignore
      await service.handleReplacementRequested(payload, prisma);

      expect(stellar.getLatestLedger).toHaveBeenCalled();
      expect(milestones.resetForReplacement).toHaveBeenCalledWith(engagementId, currentLedger);
      expect(prisma.engagement.update).toHaveBeenCalledWith({
        where: { id: engagementId },
        data: { status: 'REPLACEMENT_REQUESTED' },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.REPLACEMENT_REQUESTED,
        'Replacement requested',
        `The company has requested a replacement candidate for engagement ${engagementId}. Please submit proof for the new placement when ready.`,
        { engagementId },
      );
      expect(webhooks.sendWebhook).toHaveBeenCalledWith(undefined, {
        event: 'REPLACEMENT_REQUESTED',
        engagementId,
        status: 'REPLACEMENT_REQUESTED',
        timestamp: expect.any(String),
      });
    });
  });

  describe('handleEngagementCancelled', () => {
    it('should update engagement status to cancelled, notify recruiter, and dispatch webhook', async () => {
      const engagementId = 'testEngagementId';
      const payload = [engagementId];
      const recruiterAddress = 'recruiterAddress';
      const companyAddress = 'companyAddress';

      (prisma.engagement.findUnique as jest.Mock).mockResolvedValue({
        id: engagementId,
        recruiterAddress,
        companyAddress,
        status: 'IN_PROGRESS',
      });

      // @ts-ignore
      await service.handleEngagementCancelled(payload, prisma);

      expect(prisma.engagement.update).toHaveBeenCalledWith({
        where: { id: engagementId },
        data: { status: 'CANCELLED' },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        recruiterAddress,
        NotificationType.ENGAGEMENT_CANCELLED,
        'Engagement cancelled',
        `Engagement ${engagementId} has been cancelled by the company. No further payments will be made.`,
        { engagementId },
      );
      expect(webhooks.sendWebhook).toHaveBeenCalledWith(undefined, {
        event: 'CANCELLED',
        engagementId,
        status: 'CANCELLED',
        timestamp: expect.any(String),
      });
    });
  });

  describe('processUnprocessedEvents', () => {
    it('should process all unprocessed events', async () => {
      const mockUnprocessedEvents = [
        {
          id: 'event1',
          eventName: 'engagement_created',
          ledger: 1,
          txHash: 'tx1',
          payload: 'engagement1',
          processed: false,
        },
        {
          id: 'event2',
          eventName: 'milestone_unlocked',
          ledger: 2,
          txHash: 'tx2',
          payload: ['engagement2', 1],
          processed: false,
        },
      ];

      (prisma.chainEvent.findMany as jest.Mock).mockResolvedValue(mockUnprocessedEvents);
      const processEventSpy = jest.spyOn(service as any, 'processEvent').mockResolvedValue(undefined);

      await service.processUnprocessedEvents();

      expect(prisma.chainEvent.findMany).toHaveBeenCalledWith({
        where: { processed: false },
        orderBy: { ledger: 'asc' },
      });
      expect(processEventSpy).toHaveBeenCalledTimes(mockUnprocessedEvents.length);
      expect(processEventSpy).toHaveBeenCalledWith({
        ledger: mockUnprocessedEvents[0].ledger,
        txHash: mockUnprocessedEvents[0].txHash,
        topic: [mockUnprocessedEvents[0].eventName],
        value: mockUnprocessedEvents[0].payload,
      });
      expect(processEventSpy).toHaveBeenCalledWith({
        ledger: mockUnprocessedEvents[1].ledger,
        txHash: mockUnprocessedEvents[1].txHash,
        topic: [mockUnprocessedEvents[1].eventName],
        value: mockUnprocessedEvents[1].payload,
      });
    });

    it('should handle errors when processing individual unprocessed events', async () => {
      const mockUnprocessedEvents = [
        {
          id: 'event1',
          eventName: 'engagement_created',
          ledger: 1,
          txHash: 'tx1',
          payload: 'engagement1',
          processed: false,
        },
      ];

      (prisma.chainEvent.findMany as jest.Mock).mockResolvedValue(mockUnprocessedEvents);
      const processEventSpy = jest.spyOn(service as any, 'processEvent').mockRejectedValue(new Error('Processing error'));
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service.processUnprocessedEvents();

      expect(prisma.chainEvent.findMany).toHaveBeenCalled();
      expect(processEventSpy).toHaveBeenCalledTimes(mockUnprocessedEvents.length);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process unprocessed event'),
        'Processing error',
      );
    });
  });
});
