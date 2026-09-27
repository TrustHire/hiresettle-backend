import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import axios from 'axios';
import {
  TeamsNotificationsService,
  TEAMS_KEY_TYPES,
  isTeamsKeyType,
  ADAPTIVE_CARD_CONTENT_TYPE,
} from './teams-notifications.service';

jest.mock('axios');
const mockAxiosPost = axios.post as jest.Mock;

describe('TeamsNotificationsService', () => {
  let service: TeamsNotificationsService;

  beforeEach(async () => {
    mockAxiosPost.mockResolvedValue({ status: 200 });
    service = new TeamsNotificationsService(
      new ConfigService({ FRONTEND_URL: 'https://app.hiresettle.com' }),
    );
  });

  const cardOf = (payload: Record<string, any>) => payload.attachments[0].content;

  describe('buildPayload', () => {
    it('wraps a single Adaptive Card attachment in a message', () => {
      const payload = service.buildPayload(
        NotificationType.ENGAGEMENT_CREATED,
        'Engagement created',
        'A new engagement was created.',
        undefined,
      );

      expect(payload.type).toBe('message');
      expect(payload.attachments).toHaveLength(1);
      expect(payload.attachments[0].contentType).toBe(ADAPTIVE_CARD_CONTENT_TYPE);

      const card = cardOf(payload);
      expect(card.type).toBe('AdaptiveCard');
      expect(card.version).toBe('1.4');
      expect(card.$schema).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
    });

    it('produces a readable title and message (not raw JSON)', () => {
      const payload = service.buildPayload(
        NotificationType.DISPUTE_RAISED,
        'Dispute raised',
        'A dispute has been raised for milestone 2 on engagement Eng A.',
        { engagementTitle: 'Eng A', milestoneIndex: 2, reason: 'Incomplete work' },
      );

      const card = cardOf(payload);
      expect(card.body[0]).toEqual({
        type: 'TextBlock',
        text: '⚠️ Dispute raised',
        size: 'Large',
        weight: 'Bolder',
        wrap: true,
        color: 'Warning',
      });
      expect(card.body[1]).toEqual({
        type: 'TextBlock',
        text: 'A dispute has been raised for milestone 2 on engagement Eng A.',
        wrap: true,
      });
      expect(JSON.stringify(payload)).not.toContain('"data":');
    });

    it('renders key data fields as a FactSet', () => {
      const payload = service.buildPayload(
        NotificationType.PAYMENT_RELEASED,
        'Payment released',
        'Payment of 100 USDC released.',
        { engagementTitle: 'Eng A', milestoneIndex: 1, amount: '100 USDC' },
      );

      expect(cardOf(payload).body[2]).toEqual({
        type: 'FactSet',
        facts: [
          { title: 'Engagement', value: 'Eng A' },
          { title: 'Milestone', value: '1' },
          { title: 'Amount', value: '100 USDC' },
        ],
      });
    });

    it('omits the FactSet when there is no structured data', () => {
      const payload = service.buildPayload(
        NotificationType.MILESTONE_CONFIRMED,
        'Confirmed',
        'Milestone confirmed',
        undefined,
      );
      expect(cardOf(payload).body.some((b: any) => b.type === 'FactSet')).toBe(false);
    });

    it('falls back to the title when the message is empty', () => {
      const payload = service.buildPayload(
        NotificationType.ENGAGEMENT_CREATED,
        'Engagement created',
        '',
        undefined,
      );
      expect(cardOf(payload).body[1].text).toBe('Engagement created');
    });

    it('uses a default emoji and no color for unknown types', () => {
      const payload = service.buildPayload(
        NotificationType.ACCOUNT_MERGE_DETECTED,
        'Account merge',
        'Merged',
        undefined,
      );
      const header = cardOf(payload).body[0];
      expect(header.text).toBe('📬 Account merge');
      expect(header.color).toBeUndefined();
    });

    it('links back to the app via an Action.OpenUrl', () => {
      const payload = service.buildPayload(
        NotificationType.MILESTONE_CONFIRMED,
        'Confirmed',
        'Milestone confirmed',
        undefined,
      );
      expect(cardOf(payload).actions).toEqual([
        {
          type: 'Action.OpenUrl',
          title: 'View in HireSettle',
          url: 'https://app.hiresettle.com',
        },
      ]);
    });
  });

  describe('send', () => {
    it('posts the Adaptive Card payload to the webhook URL', async () => {
      const webhookUrl = 'https://example.webhook.office.com/webhookb2/<id>/IncomingWebhook/<token>';
      await service.send(
        NotificationType.DISPUTE_RAISED,
        'Dispute raised',
        'A dispute was raised.',
        undefined,
        webhookUrl,
      );

      expect(mockAxiosPost).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          type: 'message',
          attachments: [expect.objectContaining({ contentType: ADAPTIVE_CARD_CONTENT_TYPE })],
        }),
        expect.objectContaining({ timeout: 10_000 }),
      );
    });

    it('propagates delivery errors so the queue can retry', async () => {
      mockAxiosPost.mockRejectedValueOnce(new Error('400 Bad Request'));
      await expect(
        service.send(
          NotificationType.DISPUTE_RAISED,
          'Dispute raised',
          'A dispute was raised.',
          undefined,
          'https://example.webhook.office.com/webhookb2/x',
        ),
      ).rejects.toThrow('400 Bad Request');
    });
  });

  describe('isTeamsKeyType', () => {
    it('mirrors the Slack key types', () => {
      expect(TEAMS_KEY_TYPES).toEqual(
        expect.arrayContaining([
          NotificationType.PAYMENT_RELEASED,
          NotificationType.DISPUTE_RAISED,
          NotificationType.ENGAGEMENT_CANCELLED,
        ]),
      );
      expect(isTeamsKeyType(NotificationType.DISPUTE_RAISED)).toBe(true);
    });

    it('excludes non-key types', () => {
      expect(isTeamsKeyType(NotificationType.RETENTION_WINDOW_APPROACHING)).toBe(false);
      expect(isTeamsKeyType(NotificationType.MILESTONE_UNLOCKED)).toBe(false);
    });
  });
});
