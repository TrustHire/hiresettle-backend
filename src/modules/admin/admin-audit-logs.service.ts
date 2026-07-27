import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogsQueryDto, UnifiedAuditLog, AuditLogsResponseDto } from './dto/audit-logs.dto';

@Injectable()
export class AdminAuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async queryAuditLogs(dto: AuditLogsQueryDto): Promise<AuditLogsResponseDto> {
    const { actorId, action, entityType, from, to, page = 1, limit = 50 } = dto;
    const skip = (page - 1) * limit;

    // Build date filter
    const dateFilter: any = {};
    if (from) {
      dateFilter.gte = new Date(from);
    }
    if (to) {
      dateFilter.lte = new Date(to);
    }

    // Query all three audit log types in parallel
    const [auditLogs, engagementAuditLogs, milestoneAuditLogs] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          ...(actorId && { changedBy: actorId }),
          ...(action && { action }),
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.engagementAuditLog.findMany({
        where: {
          ...(actorId && { changedBy: actorId }),
          ...(entityType && { engagementId: entityType }),
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.milestoneAuditLog.findMany({
        where: {
          ...(actorId && { changedBy: actorId }),
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Transform to unified format
    const unifiedLogs: UnifiedAuditLog[] = [
      ...auditLogs.map((log) => ({
        id: log.id,
        type: 'AuditLog' as const,
        actorId: log.changedBy,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        oldValue: log.oldValue,
        newValue: log.newValue,
        reason: log.reason,
        createdAt: log.createdAt,
      })),
      ...engagementAuditLogs.map((log) => ({
        id: log.id,
        type: 'EngagementAuditLog' as const,
        actorId: log.changedBy,
        action: `STATUS_CHANGE: ${log.fromStatus} -> ${log.toStatus}`,
        entityType: 'Engagement',
        entityId: log.engagementId,
        oldValue: log.fromStatus,
        newValue: log.toStatus,
        reason: log.reason,
        createdAt: log.createdAt,
      })),
      ...milestoneAuditLogs.map((log) => ({
        id: log.id,
        type: 'MilestoneAuditLog' as const,
        actorId: log.changedBy,
        action: `STATUS_CHANGE: ${log.fromStatus} -> ${log.toStatus}`,
        entityType: 'Milestone',
        entityId: log.milestoneId,
        oldValue: log.fromStatus,
        newValue: log.toStatus,
        reason: undefined,
        createdAt: log.createdAt,
      })),
    ];

    // Sort by createdAt descending
    unifiedLogs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply pagination after merging
    const paginatedLogs = unifiedLogs.slice(skip, skip + limit);

    // Get total count (simplified - for accurate count we'd need separate queries)
    const total = unifiedLogs.length;
    const totalPages = Math.ceil(total / limit);

    return {
      logs: paginatedLogs,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
