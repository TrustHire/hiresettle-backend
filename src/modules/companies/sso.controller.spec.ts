import { Test } from "@nestjs/testing";
import { SsoController } from "./sso.controller";
import { SsoService } from "./sso.service";
import { JwtOrApiKeyGuard } from "../../common/guards/jwt-or-api-key.guard";

describe("SsoController", () => {
  let controller: SsoController;
  let sso: Record<string, jest.Mock>;
  const req = { user: { id: "co" }, protocol: "https", get: () => "api.test" };

  beforeEach(async () => {
    sso = {
      upsertConfig: jest.fn().mockResolvedValue("cfg"),
      getConfig: jest.fn().mockResolvedValue("cfg"),
      buildAuthorizationUrl: jest.fn().mockResolvedValue("https://idp/auth"),
      handleOidcCallback: jest
        .fn()
        .mockResolvedValue({ id: "u", email: "e@x.y" }),
    };
    const module = await Test.createTestingModule({
      controllers: [SsoController],
      providers: [{ provide: SsoService, useValue: sso }],
    })
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(SsoController);
  });

  it("upserts and reads config using the caller id", async () => {
    await controller.upsertConfig(req, { issuer: "i" });
    expect(sso.upsertConfig).toHaveBeenCalledWith("co", { issuer: "i" });
    await controller.getConfig(req);
    expect(sso.getConfig).toHaveBeenCalledWith("co");
  });

  it("initiates OIDC with a 302 redirect", async () => {
    await expect(controller.initiateOidc("c1", req)).resolves.toEqual({
      url: "https://idp/auth",
      statusCode: 302,
    });
    expect(sso.buildAuthorizationUrl).toHaveBeenCalledWith(
      "c1",
      "https://api.test/auth/sso/oidc/c1/callback",
    );
  });

  it("handles the OIDC callback", async () => {
    await expect(controller.oidcCallback("c1", "code", req)).resolves.toEqual({
      userId: "u",
      email: "e@x.y",
    });
    expect(sso.handleOidcCallback).toHaveBeenCalledWith(
      "c1",
      "code",
      "https://api.test/auth/sso/oidc/c1/callback",
    );
  });
});
