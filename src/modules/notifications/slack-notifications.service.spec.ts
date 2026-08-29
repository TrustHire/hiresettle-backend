import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import axios from 'axios';
import {
  SlackNotificationsService,
  SLACK_KEY_TYPES,
  isSlackKeyType,
} from './slack-notifications.service';

jest.mock('axios');
const mockAxiosPost = axios.post as jest.Mock;

describe('SlackNotificationsService', () => {
  let service: SlackNotificationsService;

  beforeEach(async () => {
    mockAxiosPost.mockResolvedValue({ status: 200 });
    service = new SlackNotificationsService(
      new ConfigService({ FRONTEND_URL: 'https://app.hiresettle.com' }),
    );
  });

  describe('buildPayload', () => {
    it('produces a readable header and message (not raw JSON)', () => {
      const payload = service.buildPayload(
        NotificationType.DISPUTE_RAISED,
        'Dispute raised',
        'A dispute has been raised for milestone 2 on engagement Eng A.',
        { engagementTitle: 'Eng A', milestoneIndex: 2, reason: 'Incomplete work' },
      );

      expect(payload.blocks[0]).toEqual({
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ Dispute raised', emoji: true },
      });
      expect(payload.blocks[1]).toEqual({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'A dispute has been raised for milestone 2 on engagement Eng A.',
        },
      });
      // The payload must not dump the raw notification/data JSON.
      expect(JSON.stringify(payload)).not.toContain('"data":');
      expect(JSON.stringify(payload)).not.toContain('"Incomplete work"');
    });

    it('includes a readable context line with key data fields', () => {
      const payload = service.buildPayload(
        NotificationType.PAYMENT_RELEASED,
        'Payment released',
        'Payment of 100 USDC released.',
        { engagementTitle: 'Eng A', milestoneIndex: 1, amount: '100 USDC' },
      );

      expect(payload.blocks[2]).toEqual({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Eng A* · milestone *1* · 100 USDC',
        },
      });
    });

    it('falls back to the title when the message is empty', () => {
      const payload = service.buildPayload(
        NotificationType.ENGAGEMENT_CREATED,
        'Engagement created',
        '',
        undefined,
      );
      expect(payload.blocks[1].text.text).toBe('Engagement created');
    });

    it('humanizes unknown types with a default emoji', () => {
      const payload = service.buildPayload(
        NotificationType.ACCOUNT_MERGE_DETECTED,
        'Account merge',
        'Merged',
        undefined,
      );
      expect(payload.blocks[0].text.text).toBe('📬 account merge detected');
    });

    it('escapes Slack mrkdwn special characters in the message', () => {
      const payload = service.buildPayload(
        NotificationType.MILESTONE_CONFIRMED,
        'Confirmed',
        'Milestone <2> confirmed & ready > now',
        undefined,
      );
      expect(payload.blocks[1].text.text).toBe(
        'Milestone &lt;2&gt; confirmed &amp; ready &gt; now',
      );
    });

    it('links back to the app via the FRONTEND_URL context block', () => {
      const payload = service.buildPayload(
        NotificationType.MILESTONE_CONFIRMED,
        'Confirmed',
        'Milestone confirmed',
        undefined,
      );
      const context = payload.blocks[payload.blocks.length - 1];
      expect(context.type).toBe('context');
      expect(JSON.stringify(context)).toContain(
        '<https://app.hiresettle.com|View in HireSettle>',
      );
    });
  });

  describe('send', () => {
    it('posts the readable payload to the webhook URL', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/<team-id>/<webhook-id>/<token>';
      await service.send(
        NotificationType.DISPUTE_RAISED,
        'Dispute raised',
        'A dispute was raised.',
        undefined,
        webhookUrl,
      );

      expect(mockAxiosPost).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({ blocks: expect.any(Array) }),
        expect.objectContaining({ timeout: 10_000 }),
      );
    });
  });

  describe('isSlackKeyType', () => {
    it('includes the key company-facing types', () => {
      expect(SLACK_KEY_TYPES).toEqual(
        expect.arrayContaining([
          NotificationType.PAYMENT_RELEASED,
          NotificationType.DISPUTE_RAISED,
          NotificationType.ENGAGEMENT_CANCELLED,
          NotificationType.REPLACEMENT_REQUESTED,
          NotificationType.PROOF_SUBMITTED,
        ]),
      );
      expect(isSlackKeyType(NotificationType.DISPUTE_RAISED)).toBe(true);
    });

    it('excludes non-key types', () => {
      expect(isSlackKeyType(NotificationType.RETENTION_WINDOW_APPROACHING)).toBe(false);
      expect(isSlackKeyType(NotificationType.MILESTONE_UNLOCKED)).toBe(false);
    });
  });
});
