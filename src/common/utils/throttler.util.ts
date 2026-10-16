const HEALTH_PATH = "/health";
const STATUS_PATH = "/status";

export function shouldSkipThrottling(
  path: string,
  apiPrefix = "api/v1",
): boolean {
  const normalizedPath = path.replace(/\/+$/, "");
  const normalizedPrefix = apiPrefix.replace(/^\/+|\/+$/g, "");
  const prefixedStatusPath = normalizedPrefix
    ? `/${normalizedPrefix}${STATUS_PATH}`
    : STATUS_PATH;

  return (
    normalizedPath === HEALTH_PATH ||
    normalizedPath === STATUS_PATH ||
    normalizedPath === prefixedStatusPath
  );
}
