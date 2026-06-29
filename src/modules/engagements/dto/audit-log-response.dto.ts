// src/modules/engagements/dto/audit-log-response.dto.ts

export class AuditLogEntryDto {
  id: string;
  engagementId: string;
  fromStatus: string;
  toStatus: string;
  changedBy: string;
  reason: string | null;
  createdAt: Date;
}