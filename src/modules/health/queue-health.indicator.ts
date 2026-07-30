import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * QueueHealthIndicator
 *
 * Checks BullMQ queue health by verifying Redis connectivity.
 * Uses the email queue's Redis client to issue a PING. All three queues
 * (email, stellar-tx, webhook) share the same Redis connection from
 * BullModule.forRootAsync, so a single ping is sufficient.
 *
 * Reports unhealthy (HTTP 503) if the Redis connection is not reachable.
 * When healthy, also surfaces lightweight queue stats (waiting / active /
 * delayed / failed counts on the email queue) so operators can spot
 * stalled jobs at a glance.
 */
@Injectable()
export class QueueHealthIndicator {
  private readonly logger = new Logger(QueueHealthIndicator.name);

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      // Access the underlying ioredis client and send a PING
      const client = await this.emailQueue.client as any;
      const pong = await client.ping();

      if (pong !== 'PONG') {
        return { queues: { status: 'down', message: `Unexpected Redis response: ${pong}` } };
      }

      // Surface lightweight queue counts to aid operator visibility
      const [waiting, active, delayed, failed] = await Promise.all([
        this.emailQueue.getWaitingCount(),
        this.emailQueue.getActiveCount(),
        this.emailQueue.getDelayedCount(),
        this.emailQueue.getFailedCount(),
      ]);

      return { queues: { status: 'up', redis: 'connected', waiting, active, delayed, failed } };
    } catch (error) {
      this.logger.error('Queue health check failed', error.message);
      return { queues: { status: 'down', message: error.message } };
    }
  }
}
