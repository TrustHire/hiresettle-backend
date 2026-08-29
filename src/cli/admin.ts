import axios, { AxiosInstance } from "axios";

type AdminCliConfig = {
  baseUrl: string;
  apiKey: string;
};

export function createAdminClient(config: AdminCliConfig): AxiosInstance {
  return axios.create({
    baseURL: config.baseUrl.replace(/\/$/, ""),
    headers: { "X-Api-Key": config.apiKey },
  });
}

export function getConfig(
  env: NodeJS.ProcessEnv = process.env,
): AdminCliConfig {
  const apiKey = env.ADMIN_API_KEY;
  if (!apiKey) {
    throw new Error("ADMIN_API_KEY is required");
  }

  return {
    baseUrl: env.ADMIN_API_URL ?? "http://localhost:3000/api/v1",
    apiKey,
  };
}

export async function run(
  argv: string[],
  client: AxiosInstance,
): Promise<unknown> {
  const [resource, action, identifier] = argv;

  if (resource === "user" && action === "lookup" && identifier) {
    const response = await client.get("/admin/users", {
      params: { search: identifier, limit: 100 },
    });
    return response.data?.data ?? response.data;
  }

  if (resource === "webhook" && action === "resend" && identifier) {
    const response = await client.post(
      `/admin/webhooks/deliveries/${encodeURIComponent(identifier)}/resend`,
    );
    return response.data?.data ?? response.data;
  }

  throw new Error(
    "Usage: npm run admin:cli -- <user lookup QUERY|webhook resend DELIVERY_ID>",
  );
}

async function main() {
  try {
    const result = await run(
      process.argv.slice(2),
      createAdminClient(getConfig()),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message ?? error.message;
      process.stderr.write(`Admin API request failed: ${message}\n`);
    } else {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
