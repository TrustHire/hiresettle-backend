const HEALTH_PATH = "/health";
const STATUS_PATH = "/status";

export function shouldSkipThrottling(path: string): boolean {
  const normalizedPath = path.replace(/\/+$/, "");
  return (
    normalizedPath === HEALTH_PATH ||
    normalizedPath === STATUS_PATH ||
    normalizedPath.endsWith(STATUS_PATH)
  );
}
