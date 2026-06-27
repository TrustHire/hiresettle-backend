import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { MilestonesService } from '../milestones/milestones.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EngagementsService } from '../engagements/engagements.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationType } from '@prisma/client';

/**
 * EventsService
 *
 * Polls the Stellar RPC every 5 seconds for HireSettle contract events.
 * When events are detected:
 * 1. Routes each event to the correct handler
 * 2. Updates Prisma DB records (engagement status, milestone status)
 * 3. Dispatches notifications to company, recruiter, or arbiter
 * 4. Dispatches background HTTP webhooks to company-registered URLs
 * 5. Saves raw event to chain_events for audit trail
 */
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);
  private lastProcessedLedger = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly milestones: MilestonesService,
    private readonly notifications: NotificationsService,
    private readonly engagements: EngagementsService,
    private readonly webhooks: WebhooksService,
  ) {}

  async onModuleInit() {
    try {
      const latest = await this.stellar.getLatestLedger();
      this.lastProcessedLedger = Math.max(1, latest - 10);
      this.logger.log(`Event poller initialised at ledger ${this.lastProcessedLedger}`);
    } catch {
      this.lastProcessedLedger = 1;
      this.logger.warn('Could not fetch latest ledger on init — will retry on first poll');
    }
  }

  // ----------------------------------------------------------
  // CRON: poll every 5 seconds
  // ----------------------------------------------------------

  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollEvents() {
    try {
      const events = await this.stellar.fetchContractEvents(this.lastProcessedLedger);
      if (!events.length) return;

      this.logger.log(`Processing ${events.length} chain event(s)`);

      for (const event of events) {
        await this.processEvent(event);
        this.lastProcessedLedger = Math.max(this.lastProcessedLedger, event.ledger + 1);
      }
    } catch (error) {
      this.logger.error('Event polling failed', error.message);
    }
  }

  // ----------------------------------------------------------
  // EVENT DISPATCHER
  // ----------------------------------------------------------

  private async processEvent(event: any) {
    const eventName = this.extractEventName(event);
    const payload = this.extractPayload(event);
    const txHash = event.txHash ?? '';

    // Idempotency check: check if we already processed this txHash
    const existingEvent = await this.prisma.chainEvent.findFirst({
      where: { txHash, processed: true }
    });
    if (existingEvent) {
      this.logger.log(`Event with txHash ${txHash} already processed — skipping`);
      return;
    }

    // Save or get the ChainEvent
    let chainEvent = await this.prisma.chainEvent.findFirst({
      where: { txHash, eventName }
    });
    if (!chainEvent) {
      chainEvent = await this.saveRawEvent(eventName, event, payload);
    }

    if (chainEvent.processed) {
      return;
    }

    // Process the event inside a transaction
    await this.prisma.$transaction(async (tx) => {
      // Handle the event with our existing handlers
      switch (eventName) {
        case 'engagement_created':    await this.handleEngagementCreated(payload, tx); break;
        case 'milestone_unlocked':    await this.handleMilestoneUnlocked(payload, tx); break;
        case 'proof_submitted':       await this.handleProofSubmitted(payload, tx); break;
        case 'milestone_confirmed':   await this.handleMilestoneConfirmed(payload, tx); break;
        case 'dispute_raised':        await this.handleDisputeRaised(payload, tx); break;
        case 'dispute_resolved':      await this.handleDisputeResolved(payload, tx); break;
        case 'replacement_requested': await this.handleReplacementRequested(payload, tx); break;
        case 'engagement_cancelled':  await this.handleEngagementCancelled(payload, tx); break;
        default: this.logger.warn(`Unknown event: ${eventName}`);
      }

      // Mark ChainEvent as processed
      await tx.chainEvent.update({
        where: { id: chainEvent.id },
        data: { processed: true }
      });
    });
  }

  async processUnprocessedEvents() {
    const unprocessedEvents = await this.prisma.chainEvent.findMany({
      where: { processed: false },
      orderBy: { ledger: 'asc' }
    });

    for (const chainEvent of unprocessedEvents) {
      try {
        // Create a pseudo-event object from the stored ChainEvent
        const pseudoEvent = {
          ledger: chainEvent.ledger,
          txHash: chainEvent.txHash,
          topic: [chainEvent.eventName],
          value: chainEvent.payload
        };

        // Process it (reuses existing logic)
        await this.processEvent(pseudoEvent);
        this.logger.log(`Processed unprocessed event: ${chainEvent.id} (${chainEvent.eventName})`);
      } catch (error) {
        this.logger.error(`Failed to process unprocessed event ${chainEvent.id}`, error.message);
      }
    }
  }

  // ----------------------------------------------------------
  // WEBHOOK DISPATCH HELPER
  // ----------------------------------------------------------

  private async dispatchWebhookIfConfigured(
    companyAddress: string,
    eventDetails: {
      event: 'COMPLETED' | 'CANCELLED' | 'REPLACEMENT_REQUESTED' | 'DISPUTE_RAISED' | 'PAYMENT_RELEASED';
      engagementId: string;
      status: string;
    }
  ) {
    try {
      const companyUser = await this.prisma.user.findFirst({
        where: { stellarAddress: companyAddress },
        select: { webhookUrl: true },
      });

      if (companyUser?.webhookUrl) {
        await this.webhooks.sendWebhook(companyUser.webhookUrl, {
          event: eventDetails.event,
          engagementId: eventDetails.engagementId,
          status: eventDetails.status,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.error(`Webhook runtime dispatcher encounter error for engagement ${eventDetails.engagementId}:`, err.message);
    }
  }

  // ----------------------------------------------------------
  // EVENT HANDLERS
  // ----------------------------------------------------------

  private async handleEngagementCreated(payload: any, tx?: any) {
    const engagementId = String(payload);
    this.logger.log(`Engagement created on-chain: ${engagementId}`);
    
    // We already create engagement in EngagementsService.create, so just sync if needed
    await this.engagements.syncFromChain(engagementId);

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: engagementId },
    });
    if (engagement) {
      await this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.ENGAGEMENT_CREATED,
        'New engagement created',
        `A new engagement (${engagementId}) has been created for you.`,
        { engagementId },
      );
    }
  }

  private async handleMilestoneUnlocked(payload: any, tx?: any) {
    const [engagementId, milestoneIndex] = this.destructurePayload(payload);
    this.logger.log(`Milestone unlocked: ${engagementId}[${milestoneIndex}]`);

    await this.milestones.markUnlocked(String(engagementId), Number(milestoneIndex));

    await (tx || this.prisma).retentionSchedule.updateMany({
      where: { engagementId: String(engagementId), milestoneIndex: Number(milestoneIndex) },
      data: { unlocked: true },
    });

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: String(engagementId) },
    });
    if (engagement) {
      await this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.MILESTONE_UNLOCKED,
        'Retention milestone unlocked',
        `Milestone ${milestoneIndex} for engagement ${engagementId} is now available. Submit your proof to claim payment.`,
        { engagementId, milestoneIndex },
      );
    }
  }

  private async handleProofSubmitted(payload: any, tx?: any) {
    const [engagementId, milestoneIndex] = this.destructurePayload(payload);
    this.logger.log(`Proof submitted: ${engagementId}[${milestoneIndex}]`);

    await this.milestones.markProofSubmitted(
      String(engagementId), Number(milestoneIndex), '',
    );

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: String(engagementId) },
    });
    if (engagement) {
      await this.notifications.notifyUser(
        engagement.companyAddress,
        NotificationType.PROOF_SUBMITTED,
        'Proof submitted — action required',
        `Milestone ${milestoneIndex} proof has been submitted for engagement ${engagementId}. Please review and confirm or dispute.`,
        { engagementId, milestoneIndex },
      );
    }
  }

  private async handleMilestoneConfirmed(payload: any, tx?: any) {
    const [engagementId, milestoneIndex, paymentAmount] = this.destructurePayload(payload);
    this.logger.log(`Milestone confirmed: ${engagementId}[${milestoneIndex}] — ${paymentAmount} released`);

    await this.milestones.markConfirmed(
      String(engagementId),
      Number(milestoneIndex),
      BigInt(paymentAmount ?? 0),
    );

    await this.engagements.syncFromChain(String(engagementId));

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: String(engagementId) },
    });
    if (engagement) {
      const usdcAmount = this.stellar.stroopsToUsdc(BigInt(paymentAmount ?? 0));
      await this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.PAYMENT_RELEASED,
        'Payment released',
        `$${usdcAmount} USDC has been released for milestone ${milestoneIndex} on engagement ${engagementId}.`,
        { engagementId, milestoneIndex, amount: usdcAmount },
      );

      // Trigger Outgoing Webhook Event
      await this.dispatchWebhookIfConfigured(engagement.companyAddress, {
        event: 'PAYMENT_RELEASED',
        engagementId: String(engagementId),
        status: engagement.status,
      });
    }
  }

  private async handleDisputeRaised(payload: any, tx?: any) {
    const [engagementId, milestoneIndex] = this.destructurePayload(payload);
    this.logger.log(`Dispute raised: ${engagementId}[${milestoneIndex}]`);

    await this.milestones.markDisputed(String(engagementId), Number(milestoneIndex));

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: String(engagementId) },
    });
    if (engagement) {
      for (const address of [engagement.recruiterAddress, engagement.arbiterAddress]) {
        await this.notifications.notifyUser(
          address,
          NotificationType.DISPUTE_RAISED,
          'Dispute raised',
          `A dispute has been raised on milestone ${milestoneIndex} for engagement ${engagementId}.`,
          { engagementId, milestoneIndex },
        );
      }

      // Trigger Outgoing Webhook Event
      await this.dispatchWebhookIfConfigured(engagement.companyAddress, {
        event: 'DISPUTE_RAISED',
        engagementId: String(engagementId),
        status: 'DISPUTED',
      });
    }
  }

  private async handleDisputeResolved(payload: any, tx?: any) {
    const [engagementId, milestoneIndex, approved] = this.destructurePayload(payload);
    this.logger.log(`Dispute resolved: ${engagementId}[${milestoneIndex}] approved=${approved}`);

    await this.milestones.markResolved(
      String(engagementId), Number(milestoneIndex), Boolean(approved),
    );
    await this.engagements.syncFromChain(String(engagementId));

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: String(engagementId) },
    });
    if (engagement) {
      for (const address of [engagement.companyAddress, engagement.recruiterAddress]) {
        await this.notifications.notifyUser(
          address,
          NotificationType.DISPUTE_RESOLVED,
          `Dispute ${approved ? 'approved' : 'rejected'}`,
          `The dispute on milestone ${milestoneIndex} (${engagementId}) was ${approved ? 'approved — payment released' : 'rejected — recruiter must resubmit proof'}.`,
          { engagementId, milestoneIndex, approved },
        );
      }

      // Trigger Outgoing Webhook Event
      await this.dispatchWebhookIfConfigured(engagement.companyAddress, {
        event: approved ? 'COMPLETED' : 'PAYMENT_RELEASED',
        engagementId: String(engagementId),
        status: engagement.status,
      });
    }
  }

  private async handleReplacementRequested(payload: any, tx?: any) {
    const engagementId = String(Array.isArray(payload) ? payload[0] : payload);
    this.logger.log(`Replacement requested: ${engagementId}`);

    const currentLedger = await this.stellar.getLatestLedger();
    await this.milestones.resetForReplacement(engagementId, currentLedger);

    await (tx || this.prisma).engagement.update({
      where: { id: engagementId },
      data: { status: 'REPLACEMENT_REQUESTED' },
    });

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: engagementId },
    });
    if (engagement) {
      await this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.REPLACEMENT_REQUESTED,
        'Replacement requested',
        `The company has requested a replacement candidate for engagement ${engagementId}. Please submit proof for the new placement when ready.`,
        { engagementId },
      );

      // Trigger Outgoing Webhook Event
      await this.dispatchWebhookIfConfigured(engagement.companyAddress, {
        event: 'REPLACEMENT_REQUESTED',
        engagementId: engagementId,
        status: 'REPLACEMENT_REQUESTED',
      });
    }
  }

  private async handleEngagementCancelled(payload: any, tx?: any) {
    const [engagementId] = this.destructurePayload(payload);
    this.logger.log(`Engagement cancelled: ${engagementId}`);

    await (tx || this.prisma).engagement.update({
      where: { id: String(engagementId) },
      data: { status: 'CANCELLED' },
    });

    const engagement = await (tx || this.prisma).engagement.findUnique({
      where: { id: String(engagementId) },
    });
    if (engagement) {
      await this.notifications.notifyUser(
        engagement.recruiterAddress,
        NotificationType.ENGAGEMENT_CANCELLED,
        'Engagement cancelled',
        `Engagement ${engagementId} has been cancelled by the company. No further payments will be made.`,
        { engagementId },
      );

      // Trigger Outgoing Webhook Event
      await this.dispatchWebhookIfConfigured(engagement.companyAddress, {
        event: 'CANCELLED',
        engagementId: String(engagementId),
        status: 'CANCELLED',
      });
    }
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private extractEventName(event: any): string {
    try {
      const topics = event.topic ?? [];
      return topics[0]?.toString() ?? 'unknown';
    } catch { return 'unknown'; }
  }

  private extractPayload(event: any): any {
    try {
      return event.value ? JSON.parse(JSON.stringify(event.value)) : null;
    } catch { return null; }
  }

  private destructurePayload(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    return [payload];
  }

  private async saveRawEvent(eventName: string, event: any, payload: any) {
    try {
      const engagementId = Array.isArray(payload)
        ? typeof payload[0] === 'string' ? payload[0] : null
        : typeof payload === 'string' ? payload : null;

      return await this.prisma.chainEvent.create({
        data: {
          eventName,
          ledger: event.ledger ?? 0,
          txHash: event.txHash ?? '',
          payload: payload ?? {},
          engagementId: engagementId || undefined,
        },
      });
    } catch (error) {
      this.logger.error('Failed to save raw event', error.message);
      throw error;
    }
  }

  // ----------------------------------------------------------
  // READ — for EventsController
  // ----------------------------------------------------------

  async findAll(engagementId?: string, page = 1, limit = 20) {
    const where = engagementId ? { engagementId } : {};
    const [events, total] = await this.prisma.$transaction([
      this.prisma.chainEvent.findMany({
        where,
        orderBy: { ledger: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chainEvent.count({ where }),
    ]);
    return { data: events, meta: { total, page, limit } };
  }
}
