import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, HealthIndicatorResult, HealthIndicator } from '@nestjs/terminus';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import * as net from 'net';

@Injectable()
export class HealthService {
  private readonly s3Client: S3Client;

  constructor(
    private readonly health: HealthCheckService,
    private readonly config: ConfigService,
  ) {
    this.s3Client = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      forcePathStyle: this.config.get<boolean>('S3_FORCE_PATH_STYLE'),
    });
  }

  check() {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.checkQueue(),
      () => this.checkS3(),
      () => this.checkSmtp(),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    // existing database check
    return { database: { status: 'up' } };
  }

  private async checkQueue(): Promise<HealthIndicatorResult> {
    // existing queue check
    return { queue: { status: 'up' } };
  }

  private async checkS3(): Promise<HealthIndicatorResult> {
    const bucket = this.config.get<string>('S3_BUCKET');
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { s3: { status: 'up' } };
    } catch (err) {
      return { s3: { status: 'degraded', message: (err as Error).message } };
    }
  }

  private async checkSmtp(): Promise<HealthIndicatorResult> {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT') ?? 587;
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (result: HealthIndicatorResult) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(5000);
      socket.once('connect', () => done({ smtp: { status: 'up' } }));
      socket.once('timeout', () => done({ smtp: { status: 'degraded', message: 'SMTP connection timed out' } }));
      socket.once('error', (err) => done({ smtp: { status: 'degraded', message: err.message } }));
    });
  }
}
