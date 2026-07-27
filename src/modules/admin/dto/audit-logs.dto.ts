import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AuditLogsQueryDto {
  @ApiProperty({ description: 'Filter by actor (user) ID', required: false })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiProperty({ description: 'Filter by action type', required: false })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({ description: 'Filter by entity type (e.g., Engagement, Milestone)', required: false })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiProperty({ description: 'Start date (ISO 8601)', required: false })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ description: 'End date (ISO 8601)', required: false })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiProperty({ description: 'Page number (default: 1)', required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: 'Items per page (default: 50)', required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export interface UnifiedAuditLog {
  id: string;
  type: 'AuditLog' | 'EngagementAuditLog' | 'MilestoneAuditLog';
  actorId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  createdAt: Date;
}

export interface AuditLogsResponseDto {
  logs: UnifiedAuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
