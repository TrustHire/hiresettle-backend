// auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { SessionService } from './session.service';
import { WalletAuthService } from './wallet-auth.service';
import { OAuthService } from './oauth.service';
import { ApiKeysService } from './api-keys.service';
import { JwtStrategy } from './jwt.strategy';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { ApiKeyScopesGuard } from '../../common/guards/api-key-scopes.guard';
import { JwtKeysModule } from './jwt-keys/jwt-keys.module';
import { JwtKeyStore } from './jwt-keys/jwt-key-store.service';
import { JwksController } from './jwt-keys/jwks.controller';
import { ApiKeysController } from './api-keys.controller';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtKeysModule,
    // RS256 + kid when JWT_SIGNING_KEYS is set, HS256 + JWT_SECRET otherwise (#481).
    JwtModule.registerAsync({
      imports: [ConfigModule, JwtKeysModule],
      inject: [ConfigService, JwtKeyStore],
      useFactory: (config: ConfigService, keyStore: JwtKeyStore) =>
        keyStore.jwtModuleOptions(config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m')),
    }),
  ],
  controllers: [AuthController, JwksController, ApiKeysController],
  providers: [AuthService, ApiKeysService, JwtStrategy, ApiKeyGuard, JwtOrApiKeyGuard, ApiKeyScopesGuard],
  exports: [JwtModule, JwtKeysModule, AuthService, ApiKeysService, ApiKeyGuard, JwtOrApiKeyGuard, ApiKeyScopesGuard],
})
export class AuthModule {}
