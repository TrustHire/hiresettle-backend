// jwt-auth.guard.ts
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { assertClientTokenAllowed } from './client-token-scopes';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    if (err || !user) throw err || new UnauthorizedException();
    assertClientTokenAllowed(user, context);
    return user;
  }
}
