import { JwtService } from "@nestjs/jwt";

export interface GraphqlSubscriptionUser {
  id: string;
  email?: string;
  stellarAddress?: string;
  role?: string;
  exp?: number;
}

/**
 * Pull the bearer token from graphql-ws connectionParams. Accepts
 * `{ authorization: "Bearer <jwt>" }`, `{ Authorization: ... }` or
 * `{ token: "<jwt>" }`.
 */
export function extractConnectionToken(
  connectionParams?: Record<string, unknown>,
): string | null {
  if (!connectionParams) return null;
  const raw =
    connectionParams.authorization ??
    connectionParams.Authorization ??
    connectionParams.token;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value;
}

/**
 * Verify a WebSocket connection's JWT with the same secret and rules as the
 * REST JwtStrategy (access tokens only). Returns null when invalid.
 */
export async function authenticateConnection(
  jwt: JwtService,
  connectionParams?: Record<string, unknown>,
): Promise<GraphqlSubscriptionUser | null> {
  const token = extractConnectionToken(connectionParams);
  if (!token) return null;
  try {
    const payload = await jwt.verifyAsync(token);
    if (payload?.type !== "access" || !payload.sub) return null;
    return {
      id: payload.sub,
      email: payload.email,
      stellarAddress: payload.stellarAddress,
      role: payload.role,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
