import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import * as net from 'net';

@Controller('health')
export class HealthController {
  private readonly s3: S3Client;

  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      forcePathStyle: this.config.get<boolean>('S3_FORCE_PATH_STYLE'),
    });
  }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () => this.checkS3('s3'),
      () => this.checkSmtp('smtp'),
    ]);
  }

  private async checkS3(key: string): Promise<HealthIndicatorResult> {
    const bucket = this.config.get<string>('S3_BUCKET');
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return { [key]: { status: 'up' } };
    } catch (err) {
      return {
        [key]: {
          status: 'degraded',
          message: err instanceof Error ? err.message : 'S3 bucket unreachable',
        },
      };
    }
  }

  private checkSmtp(key: string): Promise<HealthIndicatorResult> {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT') ?? 587;

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (result: HealthIndicatorResult) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(5000);
      socket.once('connect', () => done({ [key]: { status: 'up' } }));
      socket.once('timeout', () =>
        done({ [key]: { status: 'degraded', message: 'SMTP connection timed out' } }),
      );
      socket.once('error', (err) =>
        done({
          [key]: {
            status: 'degraded',
            message: err instanceof Error ? err.message : 'SMTP unreachable',
          },
        }),
      );
    });
  }
}
