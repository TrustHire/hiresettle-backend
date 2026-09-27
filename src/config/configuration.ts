import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  engagement: {
    // Window (in days) after which an unfunded draft engagement is auto-cancelled.
    unfundedCancellationWindowDays: parseInt(
      process.env.ENGAGEMENT_UNFUNDED_CANCELLATION_WINDOW_DAYS ?? '14',
      10,
    ),
    // Hours before cancellation that the owner is warned.
    unfundedCancellationWarningHours: parseInt(
      process.env.ENGAGEMENT_UNFUNDED_CANCELLATION_WARNING_HOURS ?? '48',
      10,
    ),
  },
}));
