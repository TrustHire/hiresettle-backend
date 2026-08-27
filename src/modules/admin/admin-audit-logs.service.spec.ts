import { Test, TestingModule } from "@nestjs/testing";
import { AdminAuditLogsService } from "./admin-audit-logs.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { BadRequestException } from "@nestjs/common";

describe("AdminAuditLogsService", () => {
  let service: AdminAuditLogsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      auditLog: {
        findMany: jest.fn(),
      },
      engagementAuditLog: {
        findMany: jest.fn(),
      },
      milestoneAuditLog: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuditLogsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AdminAuditLogsService>(AdminAuditLogsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("queryAuditLogs", () => {
    it("should return unified audit logs from all sources", async () => {
      const mockAuditLogs = [
        {
          id: "audit-1",
          entityType: "Engagement",
          entityId: "eng-1",
          action: "STATUS_OVERRIDE",
          oldValue: "ACTIVE",
          newValue: "PAUSED",
          reason: "User request",
          changedBy: "user-1",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        },
      ];

      const mockEngagementAuditLogs = [
        {
          id: "eng-audit-1",
          engagementId: "eng-2",
          fromStatus: "ACTIVE",
          toStatus: "COMPLETED",
          changedBy: "user-2",
          reason: "Milestone completed",
          createdAt: new Date("2024-01-01T11:00:00Z"),
        },
      ];

      const mockMilestoneAuditLogs = [
        {
          id: "mile-audit-1",
          milestoneId: "mile-1",
          fromStatus: "LOCKED",
          toStatus: "UNLOCKED",
          changedBy: "user-1",
          createdAt: new Date("2024-01-01T12:00:00Z"),
        },
      ];

      mockPrisma.auditLog.findMany.mockResolvedValue(mockAuditLogs);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue(
        mockEngagementAuditLogs,
      );
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue(
        mockMilestoneAuditLogs,
      );

      const result = await service.queryAuditLogs({ page: 1, limit: 50 });

      expect(result.logs).toHaveLength(3);
      expect(result.logs[0].type).toBe("MilestoneAuditLog");
      expect(result.logs[1].type).toBe("EngagementAuditLog");
      expect(result.logs[2].type).toBe("AuditLog");
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });

    it("should filter by actorId", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue([]);

      await service.queryAuditLogs({ actorId: "user-1", page: 1, limit: 50 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { changedBy: "user-1" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
      expect(mockPrisma.engagementAuditLog.findMany).toHaveBeenCalledWith({
        where: { changedBy: "user-1" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
      expect(mockPrisma.milestoneAuditLog.findMany).toHaveBeenCalledWith({
        where: { changedBy: "user-1" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
    });

    it("should filter by action", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue([]);

      await service.queryAuditLogs({
        action: "STATUS_OVERRIDE",
        page: 1,
        limit: 50,
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { action: "STATUS_OVERRIDE" },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
    });

    it("should filter by date range", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue([]);

      await service.queryAuditLogs({
        from: "2024-01-01",
        to: "2024-01-31",
        page: 1,
        limit: 50,
      });

      const dateFilter = {
        gte: new Date("2024-01-01"),
        lte: new Date("2024-01-31"),
      };

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { createdAt: dateFilter },
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
    });

    it("should apply pagination correctly", async () => {
      const mockLogs = Array.from({ length: 100 }, (_, i) => ({
        id: `audit-${i}`,
        entityType: "Engagement",
        entityId: `eng-${i}`,
        action: "STATUS_OVERRIDE",
        oldValue: "ACTIVE",
        newValue: "PAUSED",
        reason: "Test",
        changedBy: "user-1",
        createdAt: new Date(),
      }));

      mockPrisma.auditLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue([]);

      const result = await service.queryAuditLogs({ page: 2, limit: 10 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.logs.length).toBeLessThanOrEqual(10);
    });

    it("should return empty results when no logs exist", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue([]);

      const result = await service.queryAuditLogs({ page: 1, limit: 50 });

      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe("streamAuditLogCsv", () => {
    it("streams merged audit sources within the requested date range", async () => {
      const response = {
        setHeader: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
      } as any;
      const auditLog = {
        id: "audit-1",
        entityType: "Engagement",
        entityId: "eng-1",
        action: "STATUS_OVERRIDE",
        oldValue: "ACTIVE",
        newValue: "COMPLETED",
        reason: "approved",
        changedBy: "admin-1",
        createdAt: new Date("2024-01-01T10:00:00Z"),
      };
      const engagementAuditLog = {
        id: "eng-audit-1",
        engagementId: "eng-1",
        fromStatus: "ACTIVE",
        toStatus: "COMPLETED",
        changedBy: "admin-1",
        reason: "approved",
        createdAt: new Date("2024-01-01T11:00:00Z"),
      };
      mockPrisma.auditLog.findMany.mockResolvedValue([auditLog]);
      mockPrisma.engagementAuditLog.findMany.mockResolvedValue([
        engagementAuditLog,
      ]);
      mockPrisma.milestoneAuditLog.findMany.mockResolvedValue([]);

      await service.streamAuditLogCsv("2024-01-01", "2024-01-02", response);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date("2024-01-01"),
              lte: new Date("2024-01-02"),
            },
          },
          take: 500,
        }),
      );
      expect(response.write).toHaveBeenCalledTimes(3);
      expect(response.write.mock.calls[1][0]).toContain("audit-1,AuditLog");
      expect(response.write.mock.calls[2][0]).toContain(
        "eng-audit-1,EngagementAuditLog",
      );
      expect(response.end).toHaveBeenCalled();
    });

    it("rejects an invalid date range", async () => {
      await expect(
        service.streamAuditLogCsv("2024-02-01", "2024-01-01", {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
