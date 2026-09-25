import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyScope, SCOPES_KEY } from '../decorators/api-key-scopes.decorator';

/**
 * Enforces API key scopes declared via @RequireScopes().
 *
 * Must be applied AFTER the authentication guard (ApiKeyGuard /
 * JwtOrApiKeyGuard) has populated request.user.
 *
 * Rules:
 * - If no @RequireScopes() is declared on the handler or controller the guard
 *   passes through (no restriction).
 * - If the request was authenticated via JWT (authType !== 'api_key') the
 *   guard passes through — scopes only constrain API keys.
 * - If the request was authenticated via an API key AND the key's scopes
 *   array is empty (legacy / unrestricted key), the guard passes through.
 * - Otherwise the key must possess at least one of the required scopes;
 *   if it doesn't, a 403 ForbiddenException is thrown.
 */
@Injectable()
export class ApiKeyScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No scope restriction declared — allow.
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Not authenticated via API key (e.g. JWT) — scopes don't apply.
    if (!user || user.authType !== 'api_key') {
      return true;
    }

    const keyScopes: string[] = user.scopes ?? [];

    // Empty scopes = unrestricted legacy key — allow.
    if (keyScopes.length === 0) {
      return true;
    }

    // Key must have at least one of the required scopes.
    const hasScope = requiredScopes.some((s) => keyScopes.includes(s));
    if (!hasScope) {
      throw new ForbiddenException(
        `API key lacks required scope. Required one of: ${requiredScopes.join(', ')}`,
      );
    }

    return true;
  }
}
