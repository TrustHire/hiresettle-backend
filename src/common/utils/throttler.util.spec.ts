import { shouldSkipThrottling } from "./throttler.util";

describe("shouldSkipThrottling", () => {
  it("skips the health endpoint path without depending on the query string", () => {
    const request = { path: "/health", url: "/health?full=1" };

    expect(shouldSkipThrottling(request.path)).toBe(true);
  });

  it.each(["/status", "/api/v1/status"])(
    "skips the status endpoint at %s",
    (path) => {
      expect(shouldSkipThrottling(path)).toBe(true);
    },
  );

  it.each(["/health/check", "/api/v1/health", "/api/v1/users"])(
    "does not skip %s",
    (path) => {
      expect(shouldSkipThrottling(path)).toBe(false);
    },
  );
});
