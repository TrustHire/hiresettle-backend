import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OAuthClientsController, OAuthTokenController } from './oauth-clients.controller';
import { OAuthClientsService } from './oauth-clients.service';

@Module({
  imports: [AuthModule],
  controllers: [OAuthClientsController, OAuthTokenController],
  providers: [OAuthClientsService],
  exports: [OAuthClientsService],
})
export class OAuthClientsModule {}
