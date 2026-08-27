import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AdminUsersService } from "./admin-users.service";

describe("AdminUsersService company verification", () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
  } as any;
  const notificationsService = {} as any;
  const cache = { del: jest.fn() } as any;
  let service: AdminUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminUsersService(prisma, notificationsService, cache);
  });

  it("sets verification and invalidates the public profile cache", async () => {
    const user = {
      id: "company-1",
      role: UserRole.COMPANY,
      stellarAddress: "GABC",
    };
    const updated = { ...user, verifiedAt: new Date() };
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(updated);

    await expect(service.setCompanyVerification(user.id, true)).resolves.toBe(
      updated,
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: { verifiedAt: expect.any(Date) },
      }),
    );
    expect(cache.del).toHaveBeenCalledWith("user:profile:GABC");
  });

  it("clears verification for a company", async () => {
    const user = {
      id: "company-1",
      role: UserRole.COMPANY,
      stellarAddress: null,
    };
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue({ ...user, verifiedAt: null });

    await service.setCompanyVerification(user.id, false);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { verifiedAt: null },
      }),
    );
    expect(cache.del).not.toHaveBeenCalled();
  });

  it("rejects non-company users", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "recruiter-1",
      role: UserRole.RECRUITER,
    });

    await expect(
      service.setCompanyVerification("recruiter-1", true),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects missing users", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.setCompanyVerification("missing", true),
    ).rejects.toThrow(NotFoundException);
  });
});
