import { Module } from '@nestjs/common';
import { TeamInvitesService } from './team-invites.service';
import { TeamInvitesController } from './team-invites.controller';
import { PasswordPolicyModule } from '../../common/password/password-policy.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [PasswordPolicyModule, FeatureFlagsModule],
  providers: [TeamInvitesService],
  controllers: [TeamInvitesController],
  exports: [TeamInvitesService],
})
export class TeamInvitesModule {}
