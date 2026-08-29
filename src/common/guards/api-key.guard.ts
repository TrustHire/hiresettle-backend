import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from '../../modules/auth/api-keys.service';

/**
 * Authenticates requests via the `X-Api-Key` header.
 * Rejects missing, unknown, revoked, or expired keys.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey =
      request.headers['x-api-key'] ??
      request.headers['X-Api-Key'];

    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('API key required');
    }

    try {
      request.user = await this.apiKeys.authenticate(rawKey);
      return true;
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid API key',
      );
    }
  }
}
