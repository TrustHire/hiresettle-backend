import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Engagement } from '../engagements/engagement.entity';
import { Dispute } from '../disputes/dispute.entity';
import { RecruiterStats } from './recruiter-stats.entity';

const MIN_DATA_POINTS = 3;

@Injectable()
export class RecruitersScheduler {
  private readonly logger = new Logger(RecruitersScheduler.name);

  constructor(
    @InjectRepository(Engagement)
    private readonly engagementRepository: Repository<Engagement>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(RecruiterStats)
    private readonly recruiterStatsRepository: Repository<RecruiterStats>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async recomputeResponseTimeMetrics(): Promise<void> {
    this.logger.log('Recomputing recruiter response-time metrics');

    const engagementDurations = await this.getEngagementResponseDurations();
    const disputeDurations = await this.getDisputeResponseDurations();

    const recruiterIds = new Set<string>([
      ...engagementDurations.keys(),
      ...disputeDurations.keys(),
    ]);

    for (const recruiterId of recruiterIds) {
      const engagementSamples = engagementDurations.get(recruiterId) ?? [];
      const disputeSamples = disputeDurations.get(recruiterId) ?? [];

      const stats = await this.recruiterStatsRepository.findOne({
        where: { recruiterId },
      });

      if (!stats) {
        continue;
      }

      stats.medianEngagementResponseMs =
        engagementSamples.length >= MIN_DATA_POINTS
          ? this.median(engagementSamples)
          : null;
      stats.medianDisputeResponseMs =
        disputeSamples.length >= MIN_DATA_POINTS
          ? this.median(disputeSamples)
          : null;

      await this.recruiterStatsRepository.save(stats);
    }

    this.logger.log(
      `Recomputed response-time metrics for ${recruiterIds.size} recruiters`,
    );
  }

  private async getEngagementResponseDurations(): Promise<Map<string, number[]>> {
    const engagements = await this.engagementRepository.find({
      where: { status: 'accepted' },
    });

    const durations = new Map<string, number[]>();

    for (const engagement of engagements) {
      if (!engagement.invitedAt || !engagement.respondedAt) {
        continue;
      }

      const duration =
        new Date(engagement.respondedAt).getTime() -
        new Date(engagement.invitedAt).getTime();

      if (duration < 0) {
        continue;
      }

      const samples = durations.get(engagement.recruiterId) ?? [];
      samples.push(duration);
      durations.set(engagement.recruiterId, samples);
    }

    return durations;
  }

  private async getDisputeResponseDurations(): Promise<Map<string, number[]>> {
    const disputes = await this.disputeRepository.find({
      where: { firstResponseAt: Not(IsNull()) },
    });

    const durations = new Map<string, number[]>();

    for (const dispute of disputes) {
      if (!dispute.createdAt || !dispute.firstResponseAt) {
        continue;
      }

      const duration =
        new Date(dispute.firstResponseAt).getTime() -
        new Date(dispute.createdAt).getTime();

      if (duration < 0) {
        continue;
      }

      const samples = durations.get(dispute.recruiterId) ?? [];
      samples.push(duration);
      durations.set(dispute.recruiterId, samples);
    }

    return durations;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
  }
}
