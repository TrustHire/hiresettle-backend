import { AxiosInstance } from "axios";
import { getConfig, run } from "./admin";

describe("admin CLI", () => {
  it("looks up users with the search query", async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValue({ data: { success: true, data: { data: [] } } }),
    } as unknown as AxiosInstance;

    await expect(
      run(["user", "lookup", "admin@example.com"], client),
    ).resolves.toEqual({ data: [] });
    expect(client.get).toHaveBeenCalledWith("/admin/users", {
      params: { search: "admin@example.com", limit: 100 },
    });
  });

  it("resends a webhook delivery by ID", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        data: { success: true, data: { message: "queued" } },
      }),
    } as unknown as AxiosInstance;

    await expect(
      run(["webhook", "resend", "delivery/123"], client),
    ).resolves.toEqual({ message: "queued" });
    expect(client.post).toHaveBeenCalledWith(
      "/admin/webhooks/deliveries/delivery%2F123/resend",
    );
  });

  it("requires an admin API key", () => {
    expect(() => getConfig({ ADMIN_API_URL: "http://localhost" })).toThrow(
      "ADMIN_API_KEY is required",
    );
  });
});
