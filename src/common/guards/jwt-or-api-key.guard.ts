import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiKeysService } from '../../modules/auth/api-keys.service';

/**
 * Accepts either a Bearer JWT or an `X-Api-Key` header.
 * Prefer API key when present so server-to-server callers do not need a user JWT.
 */
@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey =
      request.headers['x-api-key'] ??
      request.headers['X-Api-Key'];

    if (rawKey && typeof rawKey === 'string') {
      try {
        request.user = await this.apiKeys.authenticate(rawKey);
        return true;
      } catch (err) {
        throw new UnauthorizedException(
          err instanceof Error ? err.message : 'Invalid API key',
        );
      }
    }

    return super.canActivate(context) as Promise<boolean>;
  }
}
