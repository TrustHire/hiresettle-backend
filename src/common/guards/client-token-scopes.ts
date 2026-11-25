import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SCOPES_KEY } from '../decorators/api-key-scopes.decorator';

/**
 * OAuth client_credentials tokens are deny-by-default: they may only reach
 * routes that declare @RequireScopes(), and only with a matching scope.
 * Human JWTs and API keys are unaffected.
 */
export function assertClientTokenAllowed(user: any, context: ExecutionContext): void {
  if (user?.authType !== 'oauth_client') return;

  const required: string[] | undefined =
    Reflect.getMetadata(SCOPES_KEY, context.getHandler()) ??
    Reflect.getMetadata(SCOPES_KEY, context.getClass());

  if (!required?.length) {
    throw new ForbiddenException('This endpoint is not available to OAuth client tokens');
  }
  const granted: string[] = user.scopes ?? [];
  if (!required.some((s) => granted.includes(s))) {
    throw new ForbiddenException(`OAuth token lacks required scope. Required one of: ${required.join(', ')}`);
  }
}
