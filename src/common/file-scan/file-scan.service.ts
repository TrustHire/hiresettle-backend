import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { FileScanStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { ClamAvScannerService } from './clamav-scanner.service';
import { DistributedLockService } from '../lock/distributed-lock.service';
import {
  QUEUE_FILE_SCAN,
  QUARANTINE_PREFIX,
  FileScanJobData,
  FileScanKind,
} from './file-scan.constants';

// Uploads still PENDING after this long are re-enqueued by the sweeper
// (covers lost jobs and files uploaded before scanning existed).
const STALE_PENDING_MS = 10 * 60 * 1000;
const SWEEP_BATCH_SIZE = 100;

interface ScanTarget {
  key: string;
  fileName: string;
  uploaderId: string;
}

@Injectable()
export class FileScanService {
  private readonly logger = new Logger(FileScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly scanner: ClamAvScannerService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_FILE_SCAN) private readonly queue: Queue,
    private readonly lock: DistributedLockService,
  ) {}

  /** Queue a malware scan for a newly uploaded file. */
  async enqueue(kind: FileScanKind, id: string): Promise<void> {
    const data: FileScanJobData = { kind, id };
    await this.queue.add('scan', data, { jobId: `${kind}-${id}` });
  }

  /** Re-enqueue uploads that have been PENDING for a while. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepPending(): Promise<void> {
    const token = await this.lock.tryAcquireLock('cron:file-scan-sweep', 600_000);
    if (!token) return;
    try {
      const before = new Date(Date.now() - STALE_PENDING_MS);
      const [evidence, messages] = await Promise.all([
        this.prisma.disputeEvidence.findMany({
          where: { scanStatus: FileScanStatus.PENDING, uploadedAt: { lt: before } },
          select: { id: true },
          take: SWEEP_BATCH_SIZE,
        }),
        this.prisma.disputeMessage.findMany({
          where: { attachmentScanStatus: FileScanStatus.PENDING, createdAt: { lt: before } },
          select: { id: true },
          take: SWEEP_BATCH_SIZE,
        }),
      ]);
      for (const e of evidence) await this.enqueue('evidence', e.id);
      for (const m of messages) await this.enqueue('dispute-message', m.id);
      if (evidence.length + messages.length > 0) {
        this.logger.log(`Re-enqueued ${evidence.length + messages.length} pending malware scan(s)`);
      }
    } catch (error: any) {
      this.logger.error('Pending malware scan sweep failed', error?.message);
    } finally {
      await this.lock.releaseLock('cron:file-scan-sweep', token);
    }
  }

  /**
   * Download the file, scan it and record the verdict. Clean files become
   * downloadable; infected files are moved under the quarantine prefix and
   * the uploader is notified. Throws on scanner errors so the job retries.
   */
  async scan({ kind, id }: FileScanJobData): Promise<void> {
    const target = await this.loadPendingTarget(kind, id);
    if (!target) return; // deleted, or already scanned

    const contents = await this.s3.getObjectBuffer(target.key);
    const result = await this.scanner.scan(contents);

    if (!result.infected) {
      await this.markClean(kind, id);
      this.logger.log(`Malware scan clean: ${kind} ${id}`);
      return;
    }

    // Record the verdict first: once INFECTED the file is never served, even
    // if moving it into quarantine fails below.
    const quarantineKey = `${QUARANTINE_PREFIX}${target.key}`;
    await this.markInfected(kind, id, quarantineKey);
    try {
      await this.s3.moveObject(target.key, quarantineKey);
    } catch (error: any) {
      this.logger.error(`Failed to move ${target.key} into quarantine`, error?.message);
    }
    this.logger.warn(`Malware detected in ${kind} ${id} (${result.signature}); quarantined at ${quarantineKey}`);

    await this.notifications.notifyUserById(
      target.uploaderId,
      NotificationType.FILE_QUARANTINED,
      'Uploaded file quarantined',
      `The file "${target.fileName}" you uploaded failed a malware scan and has been quarantined. ` +
        'It will not be shared with the other parties. Please upload a clean copy.',
      { kind, id, fileName: target.fileName, signature: result.signature },
    );
  }

  private async loadPendingTarget(kind: FileScanKind, id: string): Promise<ScanTarget | null> {
    if (kind === 'evidence') {
      const evidence = await this.prisma.disputeEvidence.findUnique({ where: { id } });
      if (!evidence || evidence.scanStatus !== FileScanStatus.PENDING) return null;
      return { key: evidence.s3Path, fileName: evidence.fileName, uploaderId: evidence.uploadedBy };
    }

    const message = await this.prisma.disputeMessage.findUnique({ where: { id } });
    if (
      !message?.attachmentS3Key ||
      message.attachmentScanStatus !== FileScanStatus.PENDING
    ) {
      return null;
    }
    return {
      key: message.attachmentS3Key,
      fileName: message.attachmentName ?? 'attachment',
      uploaderId: message.authorId,
    };
  }

  private async markClean(kind: FileScanKind, id: string): Promise<void> {
    const scannedAt = new Date();
    if (kind === 'evidence') {
      await this.prisma.disputeEvidence.update({
        where: { id },
        data: { scanStatus: FileScanStatus.CLEAN, scannedAt },
      });
    } else {
      await this.prisma.disputeMessage.update({
        where: { id },
        data: { attachmentScanStatus: FileScanStatus.CLEAN, attachmentScannedAt: scannedAt },
      });
    }
  }

  private async markInfected(kind: FileScanKind, id: string, quarantineKey: string): Promise<void> {
    const scannedAt = new Date();
    if (kind === 'evidence') {
      await this.prisma.disputeEvidence.update({
        where: { id },
        data: { scanStatus: FileScanStatus.INFECTED, scannedAt, s3Path: quarantineKey, s3Url: null },
      });
    } else {
      await this.prisma.disputeMessage.update({
        where: { id },
        data: {
          attachmentScanStatus: FileScanStatus.INFECTED,
          attachmentScannedAt: scannedAt,
          attachmentS3Key: quarantineKey,
        },
      });
    }
  }
}
