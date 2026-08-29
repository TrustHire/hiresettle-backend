import { Module } from '@nestjs/common';
import { TeamInvitesService } from './team-invites.service';
import { TeamInvitesController } from './team-invites.controller';
import { PasswordPolicyModule } from '../../common/password/password-policy.module';

@Module({
  imports: [PasswordPolicyModule],
  providers: [TeamInvitesService],
  controllers: [TeamInvitesController],
  exports: [TeamInvitesService],
})
export class TeamInvitesModule {}
