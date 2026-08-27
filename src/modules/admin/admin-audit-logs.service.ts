import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogsQueryDto, UnifiedAuditLog, AuditLogsResponseDto } from './dto/audit-logs.dto';
import { Response } from 'express';

const AUDIT_EXPORT_BATCH_SIZE = 500;

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function auditCsvRow(values: unknown[]): string {
  return `${values.map(escapeCsv).join(',')}\n`;
}

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

  async streamAuditLogCsv(from: string, to: string, res: Response): Promise<void> {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid date range. Use ISO 8601 dates.');
    }
    if (fromDate > toDate) {
      throw new BadRequestException('"from" must be before "to".');
    }

    const where = { createdAt: { gte: fromDate, lte: toDate } };
    const makeSource = (fetch: (cursor?: string) => Promise<any[]>) => ({
      fetch,
      rows: [] as any[],
      index: 0,
      cursor: undefined as string | undefined,
      done: false,
    });
    const sources = [
      makeSource((cursor) => this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: AUDIT_EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })),
      makeSource((cursor) => this.prisma.engagementAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: AUDIT_EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })),
      makeSource((cursor) => this.prisma.milestoneAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: AUDIT_EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.write('id,type,entityType,entityId,action,oldValue,newValue,reason,changedBy,createdAt\n');

    const write = async (chunk: string) => {
      if (res.write(chunk)) return;
      await new Promise<void>((resolve) => res.once('drain', resolve));
    };

    await Promise.all(sources.map(async (source) => {
      source.rows = await source.fetch();
      if (source.rows.length === 0) source.done = true;
    }));

    while (sources.some((source) => !source.done)) {
      let selectedSource: (typeof sources)[number] | undefined;
      for (const source of sources) {
        const row = source.rows[source.index];
        if (!row) continue;
        const selectedRow = selectedSource?.rows[selectedSource.index];
        if (!selectedRow || row.createdAt < selectedRow.createdAt ||
          (row.createdAt.getTime() === selectedRow.createdAt.getTime() && row.id < selectedRow.id)) {
          selectedSource = source;
        }
      }

      if (!selectedSource) break;
      const row = selectedSource.rows[selectedSource.index++];
      const isEngagementLog = 'engagementId' in row;
      const isMilestoneLog = 'milestoneId' in row;
      await write(auditCsvRow([
        row.id,
        isEngagementLog ? 'EngagementAuditLog' : isMilestoneLog ? 'MilestoneAuditLog' : 'AuditLog',
        isEngagementLog ? 'Engagement' : isMilestoneLog ? 'Milestone' : row.entityType,
        isEngagementLog ? row.engagementId : isMilestoneLog ? row.milestoneId : row.entityId,
        isEngagementLog || isMilestoneLog ? `STATUS_CHANGE: ${row.fromStatus} -> ${row.toStatus}` : row.action,
        isEngagementLog || isMilestoneLog ? row.fromStatus : row.oldValue,
        isEngagementLog || isMilestoneLog ? row.toStatus : row.newValue,
        row.reason,
        row.changedBy,
        row.createdAt.toISOString(),
      ]));

      if (selectedSource.index === selectedSource.rows.length) {
        selectedSource.cursor = row.id;
        selectedSource.rows = await selectedSource.fetch(selectedSource.cursor);
        selectedSource.index = 0;
        if (selectedSource.rows.length === 0) selectedSource.done = true;
      }
    }

    res.end();
  }
}
