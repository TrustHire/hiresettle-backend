import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttle key: JWT sub (user id) instead of IP.
 * Assumes JwtAuthGuard/Passport has already populated req.user.
 */
@Injectable()
export class UserJwtSubThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>, _res: any, _options: any): string {
    // req.user is set by JwtStrategy.validate() + Passport.
    // In this app: { id: payload.sub, stellarAddress, role }
    const user = req.user;
    const sub = user?.id;
    return sub ? `sub:${sub}` : 'anonymous';
  }
}


