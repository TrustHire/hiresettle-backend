import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
jest.mock("../../common/prisma/prisma.service", () => ({
  PrismaService: class {},
}));

import { EngagementTemplatesService } from "./engagement-templates.service";

const COMPANY = "company-1";
const OTHER = "company-2";

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  companyId: COMPANY,
  name: "Backend Engineer",
  jobTitle: "Senior Engineer",
  jobDescription: "Build APIs",
  salaryRange: "$100k",
  location: "Remote",
  milestoneConfig: { milestones: [{ name: "Placement", paymentPercent: 100 }] },
  currentVersion: 1,
  isPublic: false,
  archived: false,
  usageCount: 3,
  lastUsedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("EngagementTemplatesService", () => {
  let service: EngagementTemplatesService;
  let tx: any;
  let prisma: any;

  beforeEach(() => {
    tx = {
      engagementTemplate: { create: jest.fn(), update: jest.fn() },
      engagementTemplateVersion: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((cb: (t: any) => unknown) => cb(tx)),
      engagementTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      engagementTemplateVersion: { findMany: jest.fn() },
    };
    service = new EngagementTemplatesService(prisma);
  });

  describe("create", () => {
    it("creates the template and its first version in one transaction", async () => {
      const created = makeTemplate();
      tx.engagementTemplate.create.mockResolvedValue(created);

      const dto = {
        name: created.name,
        jobTitle: created.jobTitle,
        jobDescription: created.jobDescription,
        salaryRange: created.salaryRange,
        location: created.location,
        milestoneConfig: created.milestoneConfig,
      };
      const result = await service.create(COMPANY, dto);

      expect(result).toBe(created);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.engagementTemplate.create).toHaveBeenCalledWith({
        data: { companyId: COMPANY, ...dto, currentVersion: 1 },
      });
      expect(tx.engagementTemplateVersion.create).toHaveBeenCalledWith({
        data: {
          templateId: "tpl-1",
          version: 1,
          name: created.name,
          jobTitle: created.jobTitle,
          jobDescription: created.jobDescription,
          salaryRange: created.salaryRange,
          location: created.location,
          milestoneConfig: created.milestoneConfig,
        },
      });
    });

    it("propagates errors from the transaction", async () => {
      tx.engagementTemplate.create.mockRejectedValue(new Error("db down"));
      await expect(
        service.create(COMPANY, {
          name: "a",
          jobTitle: "b",
          milestoneConfig: {},
        }),
      ).rejects.toThrow("db down");
      expect(tx.engagementTemplateVersion.create).not.toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("lists non-archived templates of the company, newest first", async () => {
      const list = [makeTemplate()];
      prisma.engagementTemplate.findMany.mockResolvedValue(list);

      await expect(service.findAll(COMPANY)).resolves.toBe(list);
      expect(prisma.engagementTemplate.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY, archived: false },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findOne", () => {
    it("returns the template for its owner", async () => {
      const t = makeTemplate();
      prisma.engagementTemplate.findUnique.mockResolvedValue(t);
      await expect(service.findOne("tpl-1", COMPANY)).resolves.toBe(t);
    });

    it("throws NotFoundException when missing", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne("nope", COMPANY)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws ForbiddenException for another company", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(service.findOne("tpl-1", OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("findVersions", () => {
    it("returns versions in descending order after the ownership check", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      const versions = [{ version: 2 }, { version: 1 }];
      prisma.engagementTemplateVersion.findMany.mockResolvedValue(versions);

      await expect(service.findVersions("tpl-1", COMPANY)).resolves.toBe(
        versions,
      );
      expect(prisma.engagementTemplateVersion.findMany).toHaveBeenCalledWith({
        where: { templateId: "tpl-1" },
        orderBy: { version: "desc" },
      });
    });

    it("does not query versions when the caller is not the owner", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(service.findVersions("tpl-1", OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.engagementTemplateVersion.findMany).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for an unknown template", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findVersions("x", COMPANY)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("update", () => {
    it("creates a new version merging the dto over the existing values", async () => {
      const existing = makeTemplate({ currentVersion: 2, isPublic: true });
      prisma.engagementTemplate.findUnique.mockResolvedValue(existing);
      tx.engagementTemplate.update.mockResolvedValue({
        ...existing,
        currentVersion: 3,
      });

      const result = await service.update("tpl-1", COMPANY, {
        name: "Renamed",
        location: "Rome",
      });

      const merged = {
        name: "Renamed",
        jobTitle: existing.jobTitle,
        jobDescription: existing.jobDescription,
        salaryRange: existing.salaryRange,
        location: "Rome",
        milestoneConfig: existing.milestoneConfig,
      };
      expect(tx.engagementTemplateVersion.create).toHaveBeenCalledWith({
        data: { templateId: "tpl-1", version: 3, ...merged },
      });
      expect(tx.engagementTemplate.update).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
        data: { ...merged, currentVersion: 3, isPublic: true },
      });
      expect(result.currentVersion).toBe(3);
    });

    it("applies an explicit isPublic value", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isPublic: true }),
      );
      await service.update("tpl-1", COMPANY, { isPublic: false });
      expect(tx.engagementTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublic: false, currentVersion: 2 }),
        }),
      );
    });

    it("rejects updates from a non-owner without opening a transaction", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(
        service.update("tpl-1", OTHER, { name: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for an unknown template", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.update("x", COMPANY, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("soft-deletes by setting archived", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(service.remove("tpl-1", COMPANY)).resolves.toEqual({
        success: true,
      });
      expect(prisma.engagementTemplate.update).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
        data: { archived: true },
      });
    });

    it("rejects removal by a non-owner", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(service.remove("tpl-1", OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.engagementTemplate.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for an unknown template", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.remove("x", COMPANY)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("clone", () => {
    it('clones with the default "(copy)" name', async () => {
      const source = makeTemplate();
      prisma.engagementTemplate.findUnique.mockResolvedValue(source);
      tx.engagementTemplate.create.mockResolvedValue(
        makeTemplate({ id: "tpl-2" }),
      );

      await service.clone("tpl-1", COMPANY);

      expect(tx.engagementTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: COMPANY,
          name: "Backend Engineer (copy)",
          jobTitle: source.jobTitle,
          currentVersion: 1,
        }),
      });
    });

    it("uses the provided name and maps null optional fields to undefined", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(
        makeTemplate({
          jobDescription: null,
          salaryRange: null,
          location: null,
        }),
      );
      tx.engagementTemplate.create.mockResolvedValue(
        makeTemplate({ id: "tpl-2" }),
      );

      await service.clone("tpl-1", COMPANY, "Custom");

      expect(tx.engagementTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Custom",
          jobDescription: undefined,
          salaryRange: undefined,
          location: undefined,
        }),
      });
    });

    it("rejects cloning a template owned by another company", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(service.clone("tpl-1", OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("browsePublic", () => {
    it("lists public, non-archived templates from other companies without PII", async () => {
      const list = [{ id: "tpl-9" }];
      prisma.engagementTemplate.findMany.mockResolvedValue(list);

      await expect(service.browsePublic(COMPANY)).resolves.toBe(list);
      const arg = prisma.engagementTemplate.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        isPublic: true,
        archived: false,
        companyId: { not: COMPANY },
      });
      expect(arg.select.companyId).toBeUndefined();
      expect(arg.orderBy).toEqual({ createdAt: "desc" });
    });
  });

  describe("adopt", () => {
    it("copies a public template into the requester company", async () => {
      const source = makeTemplate({ companyId: OTHER, isPublic: true });
      prisma.engagementTemplate.findUnique.mockResolvedValue(source);
      tx.engagementTemplate.create.mockResolvedValue(
        makeTemplate({ id: "tpl-3" }),
      );

      await service.adopt("tpl-1", COMPANY);

      expect(tx.engagementTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: COMPANY,
          name: "Backend Engineer (adopted)",
        }),
      });
    });

    it("uses a custom name when given", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isPublic: true }),
      );
      tx.engagementTemplate.create.mockResolvedValue(makeTemplate());
      await service.adopt("tpl-1", COMPANY, "Mine");
      expect(tx.engagementTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: "Mine" }),
      });
    });

    it.each([
      ["missing", null],
      ["private", makeTemplate({ isPublic: false })],
      ["archived", makeTemplate({ isPublic: true, archived: true })],
    ])(
      "throws NotFoundException when the template is %s",
      async (_label, value) => {
        prisma.engagementTemplate.findUnique.mockResolvedValue(value);
        await expect(service.adopt("tpl-1", COMPANY)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe("getStats", () => {
    it("returns usage count and last used date", async () => {
      const t = makeTemplate();
      prisma.engagementTemplate.findUnique.mockResolvedValue(t);
      await expect(service.getStats("tpl-1", COMPANY)).resolves.toEqual({
        usageCount: 3,
        lastUsedAt: t.lastUsedAt,
      });
    });

    it("rejects access by a non-owner", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(service.getStats("tpl-1", OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("exportTemplate", () => {
    it("exports only the portable fields", async () => {
      const t = makeTemplate();
      prisma.engagementTemplate.findUnique.mockResolvedValue(t);

      const out = await service.exportTemplate("tpl-1", COMPANY);

      expect(out).toEqual({
        name: t.name,
        jobTitle: t.jobTitle,
        jobDescription: t.jobDescription,
        salaryRange: t.salaryRange,
        location: t.location,
        milestoneConfig: t.milestoneConfig,
      });
      expect(out).not.toHaveProperty("companyId");
      expect(out).not.toHaveProperty("id");
    });

    it("rejects export by a non-owner", async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(makeTemplate());
      await expect(
        service.exportTemplate("tpl-1", OTHER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("importTemplate", () => {
    it("creates a template from a valid payload", async () => {
      tx.engagementTemplate.create.mockResolvedValue(makeTemplate());
      const payload = {
        name: "Imported",
        jobTitle: "Dev",
        jobDescription: "desc",
        salaryRange: "1",
        location: "EU",
        milestoneConfig: { milestones: [] },
      };

      await service.importTemplate(COMPANY, payload);

      expect(tx.engagementTemplate.create).toHaveBeenCalledWith({
        data: { companyId: COMPANY, ...payload, currentVersion: 1 },
      });
    });

    it.each([
      ["name", { jobTitle: "Dev", milestoneConfig: {} }],
      ["jobTitle", { name: "n", milestoneConfig: {} }],
      ["milestoneConfig", { name: "n", jobTitle: "Dev" }],
      ["payload", null],
      ["payload", undefined],
    ])(
      "throws BadRequestException when %s is missing",
      async (_field, payload) => {
        await expect(
          service.importTemplate(COMPANY, payload),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });
});
