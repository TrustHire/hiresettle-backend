import { Test } from "@nestjs/testing";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CompaniesController } from "./companies.controller";
import { CompaniesService } from "./companies.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CompanyRoleGuard } from "../../common/guards/company-role.guard";
import { InitiateTransferDto } from "./dto/initiate-transfer.dto";
import { UpdateProofSlaSettingsDto } from "./dto/proof-sla-settings.dto";
import { CompanyStatsQueryDto } from "./dto/company-stats-query.dto";
import { SetSpendingLimitDto } from "./dto/spending-limit.dto";

describe("CompaniesController", () => {
  let controller: CompaniesController;
  let service: Record<string, jest.Mock>;
  const req = { user: { id: "u1" } };

  beforeEach(async () => {
    service = {
      getProofSlaSettings: jest.fn().mockResolvedValue("get"),
      updateProofSlaSettings: jest.fn().mockResolvedValue("upd"),
      initiateTransfer: jest.fn().mockResolvedValue("init"),
      acceptTransfer: jest.fn().mockResolvedValue("acc"),
      cancelTransfer: jest.fn().mockResolvedValue("can"),
      getPendingTransfer: jest.fn().mockResolvedValue("pend"),
      getEngagementStats: jest.fn().mockResolvedValue("stats"),
      setMemberSpendingLimit: jest.fn().mockResolvedValue("lim"),
    };
    const allow = { canActivate: () => true };
    const module = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [{ provide: CompaniesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(CompanyRoleGuard)
      .useValue(allow)
      .compile();
    controller = module.get(CompaniesController);
  });

  it("delegates proof SLA get/update", async () => {
    await expect(controller.getProofSla(req)).resolves.toBe("get");
    expect(service.getProofSlaSettings).toHaveBeenCalledWith("u1");
    const dto = { proofSlaDays: 5 } as any;
    await expect(controller.updateProofSla(req, dto)).resolves.toBe("upd");
    expect(service.updateProofSlaSettings).toHaveBeenCalledWith("u1", dto);
  });

  it("delegates ownership transfer routes", async () => {
    await expect(
      controller.initiateTransfer(req, { newOwnerId: "n" }),
    ).resolves.toBe("init");
    expect(service.initiateTransfer).toHaveBeenCalledWith("u1", "n");
    await expect(controller.acceptTransfer(req)).resolves.toBe("acc");
    await expect(controller.cancelTransfer(req)).resolves.toBe("can");
    await expect(controller.getPendingTransfer(req)).resolves.toBe("pend");
  });

  it("delegates engagement stats", async () => {
    await expect(
      controller.getEngagementStats(req, { dateFrom: "a", dateTo: "b" }),
    ).resolves.toBe("stats");
    expect(service.getEngagementStats).toHaveBeenCalledWith("u1", "a", "b");
  });

  it("delegates spending limit", async () => {
    const dto = { spendingLimit: 5 };
    await expect(
      controller.setMemberSpendingLimit(req, "m1", dto),
    ).resolves.toBe("lim");
    expect(service.setMemberSpendingLimit).toHaveBeenCalledWith(
      "u1",
      "m1",
      dto,
    );
  });

  describe("DTO validation", () => {
    const errors = (cls: any, obj: object) =>
      validate(plainToInstance(cls, obj));

    it("InitiateTransferDto requires a UUID", async () => {
      expect(
        await errors(InitiateTransferDto, { newOwnerId: "nope" }),
      ).toHaveLength(1);
      expect(
        await errors(InitiateTransferDto, {
          newOwnerId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        }),
      ).toHaveLength(0);
    });

    it("UpdateProofSlaSettingsDto enforces range and enum", async () => {
      expect(await errors(UpdateProofSlaSettingsDto, {})).toHaveLength(0);
      expect(
        await errors(UpdateProofSlaSettingsDto, { proofSlaDays: "10" }),
      ).toHaveLength(0);
      expect(
        await errors(UpdateProofSlaSettingsDto, { proofSlaDays: 0 }),
      ).toHaveLength(1);
      expect(
        await errors(UpdateProofSlaSettingsDto, { proofSlaDays: 91 }),
      ).toHaveLength(1);
      expect(
        await errors(UpdateProofSlaSettingsDto, { proofSlaAction: "BOGUS" }),
      ).toHaveLength(1);
    });

    it("CompanyStatsQueryDto validates ISO dates", async () => {
      expect(await errors(CompanyStatsQueryDto, {})).toHaveLength(0);
      expect(
        await errors(CompanyStatsQueryDto, { dateFrom: "2026-01-01" }),
      ).toHaveLength(0);
      expect(
        await errors(CompanyStatsQueryDto, { dateTo: "yesterday" }),
      ).toHaveLength(1);
    });

    it("SetSpendingLimitDto validates integer >= 0", async () => {
      expect(await errors(SetSpendingLimitDto, {})).toHaveLength(0);
      expect(
        await errors(SetSpendingLimitDto, { spendingLimit: null }),
      ).toHaveLength(0);
      expect(
        await errors(SetSpendingLimitDto, { spendingLimit: -1 }),
      ).toHaveLength(1);
      expect(
        await errors(SetSpendingLimitDto, { spendingLimit: 1.5 }),
      ).toHaveLength(1);
    });
  });
});
