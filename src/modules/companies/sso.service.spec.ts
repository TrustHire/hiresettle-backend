import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { SsoProtocol } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { SsoService } from "./sso.service";

const jsonRes = (body: any, ok = true) => ({ ok, json: async () => body });
const idToken = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("SsoService", () => {
  let service: SsoService;
  let prisma: any;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  const cfg = (over: any = {}) => ({
    isEnabled: true,
    protocol: SsoProtocol.OIDC,
    clientId: "cid",
    clientSecret: "sec",
    metadataUrl: "https://idp/.well-known",
    defaultRole: "RECRUITER",
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      companySsoConfig: { upsert: jest.fn(), findUnique: jest.fn() },
      user: { upsert: jest.fn() },
      companyMember: { upsert: jest.fn() },
    };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    const module = await Test.createTestingModule({
      providers: [
        SsoService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();
    service = module.get(SsoService);
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it("upsertConfig upserts by companyId", async () => {
    prisma.companySsoConfig.upsert.mockResolvedValue("ok");
    await expect(service.upsertConfig("c", { issuer: "i" })).resolves.toBe(
      "ok",
    );
    const arg = prisma.companySsoConfig.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ companyId: "c" });
    expect(arg.create).toEqual({ companyId: "c", issuer: "i" });
  });

  describe("getConfig", () => {
    it("throws NotFound when missing", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(null);
      await expect(service.getConfig("c")).rejects.toThrow(NotFoundException);
    });
    it("returns the config", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(cfg());
      await expect(service.getConfig("c")).resolves.toMatchObject({
        clientId: "cid",
      });
    });
  });

  describe("buildAuthorizationUrl", () => {
    it("rejects when disabled", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(
        cfg({ isEnabled: false }),
      );
      await expect(service.buildAuthorizationUrl("c", "r")).rejects.toThrow(
        BadRequestException,
      );
    });
    it("rejects non-OIDC protocol", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(
        cfg({ protocol: SsoProtocol.SAML }),
      );
      await expect(service.buildAuthorizationUrl("c", "r")).rejects.toThrow(
        "Only OIDC",
      );
    });
    it("rejects incomplete config", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(
        cfg({ clientId: null }),
      );
      await expect(service.buildAuthorizationUrl("c", "r")).rejects.toThrow(
        "Incomplete",
      );
    });
    it("rejects when discovery fetch fails", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(cfg());
      fetchMock.mockResolvedValue(jsonRes({}, false));
      await expect(service.buildAuthorizationUrl("c", "r")).rejects.toThrow(
        BadRequestException,
      );
    });
    it("builds the authorization url with state", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(cfg());
      fetchMock.mockResolvedValue(
        jsonRes({ authorization_endpoint: "https://idp/auth" }),
      );
      const url = new URL(
        await service.buildAuthorizationUrl("c", "https://app/cb"),
      );
      expect(url.origin + url.pathname).toBe("https://idp/auth");
      expect(url.searchParams.get("client_id")).toBe("cid");
      expect(url.searchParams.get("redirect_uri")).toBe("https://app/cb");
      const state = JSON.parse(
        Buffer.from(url.searchParams.get("state")!, "base64url").toString(),
      );
      expect(state.companyId).toBe("c");
    });
  });

  describe("handleOidcCallback", () => {
    const discovery = jsonRes({ token_endpoint: "https://idp/token" });

    beforeEach(() =>
      prisma.companySsoConfig.findUnique.mockResolvedValue(cfg()),
    );

    it("rejects when disabled", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(
        cfg({ isEnabled: false }),
      );
      await expect(service.handleOidcCallback("c", "x", "r")).rejects.toThrow(
        BadRequestException,
      );
    });
    it("rejects missing client secret", async () => {
      prisma.companySsoConfig.findUnique.mockResolvedValue(
        cfg({ clientSecret: null }),
      );
      await expect(service.handleOidcCallback("c", "x", "r")).rejects.toThrow(
        "Incomplete",
      );
    });
    it("rejects failed token exchange", async () => {
      fetchMock
        .mockResolvedValueOnce(discovery)
        .mockResolvedValueOnce(jsonRes({}, false));
      await expect(service.handleOidcCallback("c", "x", "r")).rejects.toThrow(
        UnauthorizedException,
      );
    });
    it("rejects missing id_token", async () => {
      fetchMock
        .mockResolvedValueOnce(discovery)
        .mockResolvedValueOnce(jsonRes({}));
      await expect(service.handleOidcCallback("c", "x", "r")).rejects.toThrow(
        "No id_token",
      );
    });
    it("rejects malformed id_token", async () => {
      fetchMock
        .mockResolvedValueOnce(discovery)
        .mockResolvedValueOnce(jsonRes({ id_token: "abc" }));
      await expect(service.handleOidcCallback("c", "x", "r")).rejects.toThrow(
        "Malformed",
      );
    });
    it("rejects id_token without email", async () => {
      fetchMock
        .mockResolvedValueOnce(discovery)
        .mockResolvedValueOnce(jsonRes({ id_token: idToken({ sub: "1" }) }));
      await expect(service.handleOidcCallback("c", "x", "r")).rejects.toThrow(
        "email",
      );
    });
    it("provisions the user and links membership", async () => {
      fetchMock.mockResolvedValueOnce(discovery).mockResolvedValueOnce(
        jsonRes({
          id_token: idToken({
            email: "a@b.c",
            given_name: "A",
            family_name: "B",
          }),
        }),
      );
      prisma.user.upsert.mockResolvedValue({ id: "u1", email: "a@b.c" });
      const user = await service.handleOidcCallback("c", "code", "r");
      expect(user.id).toBe("u1");
      expect(prisma.user.upsert.mock.calls[0][0].create).toMatchObject({
        email: "a@b.c",
        firstName: "A",
        lastName: "B",
        role: "RECRUITER",
        isEmailVerified: true,
      });
      expect(prisma.companyMember.upsert.mock.calls[0][0].where).toEqual({
        companyId_memberId: { companyId: "c", memberId: "u1" },
      });
      const body = fetchMock.mock.calls[1][1].body as string;
      expect(body).toContain("code=code");
    });
    it("falls back to empty names when claims are absent", async () => {
      fetchMock
        .mockResolvedValueOnce(discovery)
        .mockResolvedValueOnce(
          jsonRes({ id_token: idToken({ email: "a@b.c" }) }),
        );
      prisma.user.upsert.mockResolvedValue({ id: "u1" });
      await service.handleOidcCallback("c", "code", "r");
      expect(prisma.user.upsert.mock.calls[0][0].create).toMatchObject({
        firstName: "",
        lastName: "",
      });
    });
  });
});
