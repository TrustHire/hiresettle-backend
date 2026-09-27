import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recruiter } from './recruiter.entity';
import { Engagement } from '../engagements/engagement.entity';
import { Dispute } from '../disputes/dispute.entity';

const MIN_DATA_POINTS = 3;

export interface RecruiterStats {
  recruiterId: string;
  responseTime: {
    medianInviteResponseMs: number | null;
    medianDisputeResponseMs: number | null;
    dataPoints: number;
  };
}

@Injectable()
export class RecruitersService {
  constructor(
    @InjectRepository(Recruiter)
    private readonly recruiters: Repository<Recruiter>,
    @InjectRepository(Engagement)
    private readonly engagements: Repository<Engagement>,
    @InjectRepository(Dispute)
    private readonly disputes: Repository<Dispute>,
  ) {}

  async getStats(recruiterId: string): Promise<RecruiterStats> {
    const responseTime = await this.computeResponseTime(recruiterId);
    return { recruiterId, responseTime };
  }

  /**
   * Computes the median time from engagement invite to accept/decline and from
   * dispute to first response. Recruiters with fewer than MIN_DATA_POINTS
   * combined data points show no value (null).
   */
  async computeResponseTime(recruiterId: string): Promise<RecruiterStats['responseTime']> {
    const inviteDurations = await this.getInviteResponseDurations(recruiterId);
    const disputeDurations = await this.getDisputeResponseDurations(recruiterId);

    const dataPoints = inviteDurations.length + disputeDurations.length;
    if (dataPoints < MIN_DATA_POINTS) {
      return {
        medianInviteResponseMs: null,
        medianDisputeResponseMs: null,
        dataPoints,
      };
    }

    return {
      medianInviteResponseMs: median(inviteDurations),
      medianDisputeResponseMs: median(disputeDurations),
      dataPoints,
    };
  }

  private async getInviteResponseDurations(recruiterId: string): Promise<number[]> {
    const engagements = await this.engagements.find({
      where: { recruiterId },
      select: ['invitedAt', 'respondedAt'],
    });

    return engagements
      .filter((e) => e.invitedAt && e.respondedAt)
      .map((e) => new Date(e.respondedAt).getTime() - new Date(e.invitedAt).getTime())
      .filter((ms) => ms >= 0);
  }

  private async getDisputeResponseDurations(recruiterId: string): Promise<number[]> {
    const disputes = await this.disputes.find({
      where: { recruiterId },
      select: ['openedAt', 'firstResponseAt'],
    });

    return disputes
      .filter((d) => d.openedAt && d.firstResponseAt)
      .map((d) => new Date(d.firstResponseAt).getTime() - new Date(d.openedAt).getTime())
      .filter((ms) => ms >= 0);
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
