import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
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
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('queues');
    try {
      // Access the underlying ioredis client and send a PING
      const client = await this.emailQueue.client;
      const pong = await client.ping();

      if (pong !== 'PONG') {
        return indicator.down({ message: `Unexpected Redis response: ${pong}` });
      }

      // Surface lightweight queue counts to aid operator visibility
      const [waiting, active, delayed, failed] = await Promise.all([
        this.emailQueue.getWaitingCount(),
        this.emailQueue.getActiveCount(),
        this.emailQueue.getDelayedCount(),
        this.emailQueue.getFailedCount(),
      ]);

      return indicator.up({ redis: 'connected', waiting, active, delayed, failed });
    } catch (error) {
      this.logger.error('Queue health check failed', error.message);
      return indicator.down({ message: error.message });
    }
  }
}
