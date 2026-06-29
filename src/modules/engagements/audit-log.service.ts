// src/modules/engagements/audit-log.service.ts

import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma, EngagementAuditLog, UserRole } from '@prisma/client';
import { AuditLogEntryDto } from './dto/audit-log-response.dto';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a status transition.
   * Must be called with a Prisma transaction client (`tx`) so the write
   * is atomic with the status update that triggered it.
   */
  async record(
    tx: Prisma.TransactionClient,
    params: {
      engagementId: string;
      fromStatus: string;
      toStatus: string;
      changedBy: string;
      reason?: string;
    },
  ): Promise<EngagementAuditLog> {
    return tx.engagementAuditLog.create({
      data: {
        engagementId: params.engagementId,
        fromStatus:   params.fromStatus,
        toStatus:     params.toStatus,
        changedBy:    params.changedBy,
        reason:       params.reason ?? null,
      },
    });
  }

  /**
   * Returns all audit log entries for an engagement, newest first.
   * Enforces access: only the hirer, worker, or an ADMIN may view logs.
   */
  async findByEngagement(
    engagementId: string,
    requestingUserId: string,
    requestingUserRole: string,
  ): Promise<AuditLogEntryDto[]> {
    // Verify the engagement exists and fetch party IDs for the access check
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      select: {
        id: true,
        companyAddress: true,
        recruiterAddress: true,
        arbiterAddress: true,
      },
    });

    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }

    const requestingUser = await this.prisma.user.findUnique({
      where: { id: requestingUserId },
      select: { stellarAddress: true },
    });

    const isParty =
      requestingUser?.stellarAddress === engagement.companyAddress ||
      requestingUser?.stellarAddress === engagement.recruiterAddress ||
      requestingUser?.stellarAddress === engagement.arbiterAddress;

    const isAdmin = requestingUserRole === UserRole.ADMIN;

    if (!isParty && !isAdmin) {
      throw new ForbiddenException('You do not have access to this audit log');
    }

    const logs = await this.prisma.engagementAuditLog.findMany({
      where:   { engagementId },
      orderBy: { createdAt: 'desc' },
    });

    return logs.map((log) => ({
      id:           log.id,
      engagementId: log.engagementId,
      fromStatus:   log.fromStatus,
      toStatus:     log.toStatus,
      changedBy:    log.changedBy,
      reason:       log.reason,
      createdAt:    log.createdAt,
    }));
  }
}