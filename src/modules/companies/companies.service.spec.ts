import { Test } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CompaniesService } from "./companies.service";

describe("CompaniesService", () => {
  let service: CompaniesService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      ownershipTransfer: { update: jest.fn() },
      companyMember: { upsert: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      companyMember: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ownershipTransfer: {
        updateMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      engagement: { findMany: jest.fn(), aggregate: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CompaniesService);
  });

  describe("proof SLA settings", () => {
    it("returns settings for an existing user", async () => {
      prisma.user.findUnique.mockResolvedValue({
        proofSlaDays: 7,
        proofSlaAction: "AUTO_APPROVE",
      });
      await expect(service.getProofSlaSettings("u1")).resolves.toEqual({
        proofSlaDays: 7,
        proofSlaAction: "AUTO_APPROVE",
      });
    });

    it("throws NotFound when user is missing", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProofSlaSettings("u1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("updates only provided fields", async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updateProofSlaSettings("u1", { proofSlaDays: 10 } as any);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        proofSlaDays: 10,
      });
    });

    it("updates both fields when provided", async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updateProofSlaSettings("u1", {
        proofSlaDays: 3,
        proofSlaAction: "ESCALATE_TO_ADMIN",
      } as any);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        proofSlaDays: 3,
        proofSlaAction: "ESCALATE_TO_ADMIN",
      });
    });

    it("sends empty data for an empty dto", async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updateProofSlaSettings("u1", {} as any);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({});
    });
  });

  describe("initiateTransfer", () => {
    it("rejects transfer to self", async () => {
      await expect(service.initiateTransfer("a", "a")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects when new owner is not a member", async () => {
      prisma.companyMember.findFirst.mockResolvedValue(null);
      prisma.companyMember.findUnique.mockResolvedValue(null);
      await expect(service.initiateTransfer("a", "b")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.ownershipTransfer.create).not.toHaveBeenCalled();
    });

    it("cancels pending transfers and creates a new one (single-user owner)", async () => {
      const expiresAt = new Date();
      prisma.companyMember.findFirst.mockResolvedValue(null);
      prisma.companyMember.findUnique.mockResolvedValue({ id: "m" });
      prisma.ownershipTransfer.create.mockResolvedValue({
        id: "t1",
        expiresAt,
      });

      const res = await service.initiateTransfer("a", "b");

      expect(prisma.companyMember.findUnique).toHaveBeenCalledWith({
        where: { companyId_memberId: { companyId: "a", memberId: "b" } },
      });
      expect(prisma.ownershipTransfer.updateMany).toHaveBeenCalled();
      const data = prisma.ownershipTransfer.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        companyId: "a",
        fromOwnerId: "a",
        toMemberId: "b",
      });
      expect(data.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 86400000,
      );
      expect(res).toMatchObject({
        transferId: "t1",
        newOwnerId: "b",
        expiresAt,
      });
    });

    it("uses companyId from membership when owner was promoted", async () => {
      prisma.companyMember.findFirst.mockResolvedValue({ companyId: "co" });
      prisma.companyMember.findUnique.mockResolvedValue({ id: "m" });
      prisma.ownershipTransfer.create.mockResolvedValue({
        id: "t",
        expiresAt: new Date(),
      });
      await service.initiateTransfer("a", "b");
      expect(
        prisma.ownershipTransfer.create.mock.calls[0][0].data.companyId,
      ).toBe("co");
    });
  });

  describe("acceptTransfer", () => {
    const pending = (over: any = {}) => ({
      id: "t1",
      companyId: "co",
      fromOwnerId: "old",
      toMemberId: "new",
      expiresAt: new Date(Date.now() + 100000),
      ...over,
    });

    it("throws NotFound when no pending transfer", async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);
      await expect(service.acceptTransfer("new")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequest when expired", async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue(
        pending({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.acceptTransfer("new")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("swaps roles and writes audit log in a transaction", async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue(pending());
      const res = await service.acceptTransfer("new");

      expect(tx.ownershipTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "t1" } }),
      );
      expect(tx.companyMember.upsert.mock.calls[0][0].update).toEqual({
        companyRole: "MEMBER",
      });
      expect(tx.companyMember.update.mock.calls[0][0].data).toEqual({
        companyRole: "OWNER",
      });
      expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
        action: "OWNERSHIP_TRANSFER",
        oldValue: "old",
        newValue: "new",
        changedBy: "new",
      });
      expect(res).toMatchObject({
        companyId: "co",
        previousOwnerId: "old",
        newOwnerId: "new",
      });
    });
  });

  describe("cancelTransfer", () => {
    it("throws NotFound when nothing to cancel", async () => {
      prisma.companyMember.findFirst.mockResolvedValue(null);
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);
      await expect(service.cancelTransfer("a")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("marks the transfer as cancelled", async () => {
      prisma.companyMember.findFirst.mockResolvedValue(null);
      prisma.ownershipTransfer.findFirst.mockResolvedValue({ id: "t1" });
      const res = await service.cancelTransfer("a");
      expect(prisma.ownershipTransfer.update.mock.calls[0][0].where).toEqual({
        id: "t1",
      });
      expect(
        prisma.ownershipTransfer.update.mock.calls[0][0].data.cancelledAt,
      ).toBeInstanceOf(Date);
      expect(res).toEqual({ message: "Ownership transfer cancelled." });
    });
  });

  describe("getPendingTransfer", () => {
    it("returns pending:false when none", async () => {
      prisma.companyMember.findFirst.mockResolvedValue(null);
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);
      await expect(service.getPendingTransfer("a")).resolves.toEqual({
        pending: false,
      });
    });

    it("returns transfer details when pending", async () => {
      const d = new Date();
      prisma.companyMember.findFirst.mockResolvedValue(null);
      prisma.ownershipTransfer.findFirst.mockResolvedValue({
        id: "t1",
        fromOwnerId: "a",
        toMemberId: "b",
        expiresAt: d,
        createdAt: d,
      });
      await expect(service.getPendingTransfer("a")).resolves.toEqual({
        pending: true,
        transferId: "t1",
        fromOwnerId: "a",
        toMemberId: "b",
        expiresAt: d,
        createdAt: d,
      });
    });
  });

  describe("getEngagementStats", () => {
    beforeEach(() => prisma.companyMember.findFirst.mockResolvedValue(null));

    it("returns zeros for no engagements", async () => {
      prisma.engagement.findMany.mockResolvedValue([]);
      const res = await service.getEngagementStats("u1");
      expect(res.totalEngagements).toBe(0);
      expect(res.avgTimeToPlacement).toBe(0);
      expect(res.totalEscrowed).toBe("0");
      expect(res).not.toHaveProperty("dateFrom");
      expect(prisma.engagement.findMany.mock.calls[0][0].where).toEqual({
        companyId: "u1",
      });
    });

    it("aggregates amounts, statuses and average completion days", async () => {
      const day = 86400000;
      const t0 = new Date("2026-01-01T00:00:00Z");
      prisma.engagement.findMany.mockResolvedValue([
        {
          status: "COMPLETED",
          totalAmount: 100n,
          releasedAmount: 100n,
          createdAt: t0,
          updatedAt: new Date(t0.getTime() + 10 * day),
        },
        {
          status: "COMPLETED",
          totalAmount: 50n,
          releasedAmount: 20n,
          createdAt: t0,
          updatedAt: new Date(t0.getTime() + 5 * day),
        },
        {
          status: "ACTIVE",
          totalAmount: 10n,
          releasedAmount: 0n,
          createdAt: t0,
          updatedAt: t0,
        },
        {
          status: "WEIRD",
          totalAmount: 0n,
          releasedAmount: 0n,
          createdAt: t0,
          updatedAt: t0,
        },
      ]);
      const res = await service.getEngagementStats("u1");
      expect(res.totalEngagements).toBe(4);
      expect(res.byStatus.COMPLETED).toBe(2);
      expect(res.byStatus.ACTIVE).toBe(1);
      expect(res.byStatus.WEIRD).toBe(1);
      expect(res.totalEscrowed).toBe("160");
      expect(res.totalReleased).toBe("120");
      expect(res.avgTimeToPlacement).toBe(7.5);
    });

    it("applies date filters", async () => {
      prisma.engagement.findMany.mockResolvedValue([]);
      const res: any = await service.getEngagementStats(
        "u1",
        "2026-01-01",
        "2026-02-01",
      );
      const where = prisma.engagement.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toEqual(new Date("2026-01-01"));
      expect(where.createdAt.lte).toEqual(new Date("2026-02-01"));
      expect(res.dateFrom).toBe(new Date("2026-01-01").toISOString());
      expect(res.dateTo).toBe(new Date("2026-02-01").toISOString());
    });
  });

  describe("setMemberSpendingLimit", () => {
    beforeEach(() => prisma.companyMember.findFirst.mockResolvedValue(null));

    it("throws NotFound for unknown member", async () => {
      prisma.companyMember.findUnique.mockResolvedValue(null);
      await expect(
        service.setMemberSpendingLimit("o", "m", { spendingLimit: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("sets the limit", async () => {
      prisma.companyMember.findUnique.mockResolvedValue({});
      prisma.companyMember.update.mockResolvedValue({
        memberId: "m",
        spendingLimit: 5,
      });
      await service.setMemberSpendingLimit("o", "m", { spendingLimit: 5 });
      expect(prisma.companyMember.update.mock.calls[0][0].data).toEqual({
        spendingLimit: 5,
      });
    });

    it("clears the limit when omitted", async () => {
      prisma.companyMember.findUnique.mockResolvedValue({});
      await service.setMemberSpendingLimit("o", "m", {});
      expect(prisma.companyMember.update.mock.calls[0][0].data).toEqual({
        spendingLimit: null,
      });
    });
  });

  describe("enforceSpendingLimit", () => {
    beforeEach(() => prisma.companyMember.findFirst.mockResolvedValue(null));

    it("allows when membership missing", async () => {
      prisma.companyMember.findUnique.mockResolvedValue(null);
      await expect(
        service.enforceSpendingLimit("o", "m", 100),
      ).resolves.toBeUndefined();
    });

    it("allows when no cap configured", async () => {
      prisma.companyMember.findUnique.mockResolvedValue({
        spendingLimit: null,
      });
      await service.enforceSpendingLimit("o", "m", 100);
      expect(prisma.engagement.aggregate).not.toHaveBeenCalled();
    });

    it("allows when within the limit", async () => {
      prisma.companyMember.findUnique.mockResolvedValue({ spendingLimit: 100 });
      prisma.engagement.aggregate.mockResolvedValue({
        _sum: { totalAmount: 60n },
      });
      await expect(
        service.enforceSpendingLimit("o", "m", 40),
      ).resolves.toBeUndefined();
    });

    it("treats null sum as zero", async () => {
      prisma.companyMember.findUnique.mockResolvedValue({ spendingLimit: 100 });
      prisma.engagement.aggregate.mockResolvedValue({
        _sum: { totalAmount: null },
      });
      await expect(
        service.enforceSpendingLimit("o", "m", 100),
      ).resolves.toBeUndefined();
    });

    it("throws Forbidden when the limit would be exceeded", async () => {
      prisma.companyMember.findUnique.mockResolvedValue({ spendingLimit: 100 });
      prisma.engagement.aggregate.mockResolvedValue({
        _sum: { totalAmount: 60n },
      });
      await expect(service.enforceSpendingLimit("o", "m", 41)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
