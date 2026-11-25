import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as Sentry from '@sentry/node';
import { JwtKeyStore } from './jwt-keys/jwt-key-store.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(keyStore: JwtKeyStore, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Resolve the key from the token's alg/kid so tokens signed by a
      // rotated-out (but still listed) key stay valid until expiry (#481).
      algorithms: keyStore.verifyAlgorithms(),
      secretOrKeyProvider: (_req: unknown, rawJwtToken: string, done: (err: any, key?: any) => void) => {
        try {
          done(null, keyStore.verificationKeyFor(rawJwtToken));
        } catch (err) {
          done(err);
        }
      },
    });
  }

  async validate(payload: any) {
    if (payload.type === 'client') {
      return this.validateClientToken(payload);
    }

    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = {
      id: payload.sub,
      email: payload.email,
      stellarAddress: payload.stellarAddress,
      role: payload.role,
      impersonated: payload.impersonated === true,
      impersonatorId: payload.impersonatorId,
    };

    Sentry.setUser({ id: user.id, email: user.email, username: user.role });

    return user;
  }

  /**
   * OAuth client_credentials tokens act as the owning company, restricted to
   * the token's scopes (enforced by ApiKeyScopesGuard). The client is re-checked
   * on every request so revocation takes effect before the token expires.
   */
  private async validateClientToken(payload: any) {
    const client = await this.prisma.oAuthClient.findUnique({
      where: { id: payload.cid },
      select: { revokedAt: true, companyId: true },
    });
    if (!client || client.revokedAt || client.companyId !== payload.sub) {
      throw new UnauthorizedException('OAuth client has been revoked');
    }

    const user = {
      id: payload.sub,
      stellarAddress: payload.stellarAddress,
      role: payload.role,
      authType: 'oauth_client' as const,
      oauthClientId: payload.clientId,
      scopes: typeof payload.scope === 'string' && payload.scope ? payload.scope.split(' ') : [],
    };

    Sentry.setUser({ id: user.id, username: `oauth:${user.oauthClientId}` });

    return user;
  }
}
