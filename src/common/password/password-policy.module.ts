import { Global, Module } from '@nestjs/common';
import { PasswordPolicyService } from './password-policy.service';

@Global()
@Module({
  providers: [PasswordPolicyService],
  exports: [PasswordPolicyService],
})
export class PasswordPolicyModule {}
