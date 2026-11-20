jest.mock("@prisma/client", () => ({ UserRole: { COMPANY: "COMPANY" } }));
jest.mock("../../common/prisma/prisma.service", () => ({
  PrismaService: class {},
}));

import type { User } from "@prisma/client";
import { EngagementTemplatesController } from "./engagement-templates.controller";
import { EngagementTemplatesService } from "./engagement-templates.service";

describe("EngagementTemplatesController", () => {
  let controller: EngagementTemplatesController;
  let service: jest.Mocked<Record<keyof EngagementTemplatesService, jest.Mock>>;
  const user = { id: "company-1" } as User;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      findVersions: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      clone: jest.fn(),
      browsePublic: jest.fn(),
      adopt: jest.fn(),
      getStats: jest.fn(),
      exportTemplate: jest.fn(),
      importTemplate: jest.fn(),
    } as any;
    controller = new EngagementTemplatesController(
      service as unknown as EngagementTemplatesService,
    );
  });

  it("create delegates with the user id", async () => {
    const dto = { name: "n", jobTitle: "j", milestoneConfig: {} };
    service.create.mockResolvedValue("created");
    await expect(controller.create(user, dto)).resolves.toBe("created");
    expect(service.create).toHaveBeenCalledWith("company-1", dto);
  });

  it("findAll delegates", async () => {
    service.findAll.mockResolvedValue(["a"]);
    await expect(controller.findAll(user)).resolves.toEqual(["a"]);
    expect(service.findAll).toHaveBeenCalledWith("company-1");
  });

  it("browsePublic delegates", async () => {
    service.browsePublic.mockResolvedValue(["p"]);
    await expect(controller.browsePublic(user)).resolves.toEqual(["p"]);
    expect(service.browsePublic).toHaveBeenCalledWith("company-1");
  });

  it("findOne delegates", async () => {
    service.findOne.mockResolvedValue("one");
    await expect(controller.findOne(user, "t1")).resolves.toBe("one");
    expect(service.findOne).toHaveBeenCalledWith("t1", "company-1");
  });

  it("findVersions delegates", async () => {
    service.findVersions.mockResolvedValue(["v"]);
    await expect(controller.findVersions(user, "t1")).resolves.toEqual(["v"]);
    expect(service.findVersions).toHaveBeenCalledWith("t1", "company-1");
  });

  it("update delegates", async () => {
    service.update.mockResolvedValue("upd");
    await expect(controller.update(user, "t1", { name: "x" })).resolves.toBe(
      "upd",
    );
    expect(service.update).toHaveBeenCalledWith("t1", "company-1", {
      name: "x",
    });
  });

  it("clone passes the optional name, tolerating a missing body", async () => {
    service.clone.mockResolvedValue("c");
    await controller.clone(user, "t1", { name: "N" });
    expect(service.clone).toHaveBeenCalledWith("t1", "company-1", "N");
    await controller.clone(user, "t1", undefined as any);
    expect(service.clone).toHaveBeenLastCalledWith(
      "t1",
      "company-1",
      undefined,
    );
  });

  it("adopt passes the optional name, tolerating a missing body", async () => {
    service.adopt.mockResolvedValue("a");
    await controller.adopt(user, "t1", { name: "N" });
    expect(service.adopt).toHaveBeenCalledWith("t1", "company-1", "N");
    await controller.adopt(user, "t1", undefined as any);
    expect(service.adopt).toHaveBeenLastCalledWith(
      "t1",
      "company-1",
      undefined,
    );
  });

  it("remove delegates", async () => {
    service.remove.mockResolvedValue({ success: true });
    await expect(controller.remove(user, "t1")).resolves.toEqual({
      success: true,
    });
    expect(service.remove).toHaveBeenCalledWith("t1", "company-1");
  });

  it("getStats delegates", async () => {
    service.getStats.mockResolvedValue({ usageCount: 1 });
    await expect(controller.getStats(user, "t1")).resolves.toEqual({
      usageCount: 1,
    });
    expect(service.getStats).toHaveBeenCalledWith("t1", "company-1");
  });

  it("exportTemplate delegates", async () => {
    service.exportTemplate.mockResolvedValue({ name: "n" });
    await expect(controller.exportTemplate(user, "t1")).resolves.toEqual({
      name: "n",
    });
    expect(service.exportTemplate).toHaveBeenCalledWith("t1", "company-1");
  });

  it("importTemplate delegates", async () => {
    const payload = { name: "n" };
    service.importTemplate.mockResolvedValue("imp");
    await expect(controller.importTemplate(user, payload)).resolves.toBe("imp");
    expect(service.importTemplate).toHaveBeenCalledWith("company-1", payload);
  });
});
