import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';

/**
 * S3CleanupService
 *
 * Removes orphaned S3 objects that were uploaded but never referenced in the database.
 * This handles cases where:
 * 1. A presigned URL was generated but the upload was never completed
 * 2. An upload completed but the DB record was never created (crash/error)
 * 3. Files were uploaded for testing/preview but never finalized
 *
 * The service runs daily and only removes objects older than the configured grace period
 * that have no corresponding DB reference in either:
 * - User.avatarUrl (for avatar uploads)
 * - DisputeEvidence.s3Path (for evidence uploads)
 */
@Injectable()
export class S3CleanupService {
  private readonly logger = new Logger(S3CleanupService.name);
  private readonly gracePeriodHours: number;

  constructor(
    private readonly s3: S3Service,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.gracePeriodHours = this.config.get<number>('S3_CLEANUP_GRACE_PERIOD_HOURS', 24);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  async cleanupOrphanedUploads() {
    this.logger.log('Starting orphaned S3 uploads cleanup job...');

    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - this.gracePeriodHours);

    let totalDeleted = 0;

    try {
      // Cleanup orphaned avatars
      const deletedAvatars = await this.cleanupOrphanedAvatars(cutoffDate);
      totalDeleted += deletedAvatars;

      // Cleanup orphaned evidence uploads
      const deletedEvidence = await this.cleanupOrphanedEvidence(cutoffDate);
      totalDeleted += deletedEvidence;

      this.logger.log(
        `Cleanup completed. Deleted ${totalDeleted} orphaned objects (grace period: ${this.gracePeriodHours}h)`,
      );
    } catch (error) {
      this.logger.error('Failed to cleanup orphaned S3 uploads:', error.message);
    }
  }

  /**
   * Cleanup orphaned avatar uploads in the avatars/ prefix.
   */
  private async cleanupOrphanedAvatars(cutoffDate: Date): Promise<number> {
    const avatarObjects = await this.s3.listObjects('avatars/');
    const referencedAvatars = await this.getReferencedAvatarPaths();

    let deleted = 0;

    for (const obj of avatarObjects) {
      if (obj.lastModified > cutoffDate) {
        continue; // Skip objects within grace period
      }

      // Check if this S3 path is referenced in any User.avatarUrl
      const isReferenced = referencedAvatars.some(
        (avatarUrl) => avatarUrl && avatarUrl.includes(obj.key),
      );

      if (!isReferenced) {
        await this.s3.deleteObject(obj.key);
        deleted++;
        this.logger.debug(`Deleted orphaned avatar: ${obj.key}`);
      }
    }

    this.logger.log(`Deleted ${deleted} orphaned avatar(s)`);
    return deleted;
  }

  /**
   * Cleanup orphaned evidence uploads in the evidence/ prefix.
   */
  private async cleanupOrphanedEvidence(cutoffDate: Date): Promise<number> {
    const evidenceObjects = await this.s3.listObjects('evidence/');
    const referencedPaths = await this.getReferencedEvidencePaths();

    let deleted = 0;

    for (const obj of evidenceObjects) {
      if (obj.lastModified > cutoffDate) {
        continue; // Skip objects within grace period
      }

      // Check if this S3 path is referenced in DisputeEvidence.s3Path
      const isReferenced = referencedPaths.includes(obj.key);

      if (!isReferenced) {
        await this.s3.deleteObject(obj.key);
        deleted++;
        this.logger.debug(`Deleted orphaned evidence: ${obj.key}`);
      }
    }

    this.logger.log(`Deleted ${deleted} orphaned evidence file(s)`);
    return deleted;
  }

  /**
   * Get all avatar URLs referenced in the database.
   */
  private async getReferencedAvatarPaths(): Promise<(string | null)[]> {
    const users = await this.prisma.user.findMany({
      where: {
        avatarUrl: { not: null },
      },
      select: { avatarUrl: true },
    });

    return users.map((u) => u.avatarUrl);
  }

  /**
   * Get all S3 paths referenced in DisputeEvidence.
   */
  private async getReferencedEvidencePaths(): Promise<string[]> {
    const evidences = await this.prisma.disputeEvidence.findMany({
      select: { s3Path: true },
    });

    return evidences.map((e) => e.s3Path);
  }
}
