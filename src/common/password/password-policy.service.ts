import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PasswordPolicyConfig {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
}

@Injectable()
export class PasswordPolicyService {
  constructor(private readonly config: ConfigService) {}

  getPolicy(): PasswordPolicyConfig {
    return {
      minLength: this.config.get<number>('PASSWORD_MIN_LENGTH', 8),
      requireUppercase: this.parseBool('PASSWORD_REQUIRE_UPPERCASE', true),
      requireLowercase: this.parseBool('PASSWORD_REQUIRE_LOWERCASE', true),
      requireNumber: this.parseBool('PASSWORD_REQUIRE_NUMBER', true),
      requireSpecial: this.parseBool('PASSWORD_REQUIRE_SPECIAL', false),
    };
  }

  /**
   * Validates password against configured policy.
   * Throws BadRequestException whose message is an array of unmet requirements.
   */
  validate(password: string): void {
    const unmet = this.getUnmetRequirements(password);
    if (unmet.length > 0) {
      throw new BadRequestException({
        message: unmet,
        error: 'Password does not meet complexity requirements',
      });
    }
  }

  getUnmetRequirements(password: string): string[] {
    const policy = this.getPolicy();
    const unmet: string[] = [];

    if (!password || password.length < policy.minLength) {
      unmet.push(`Password must be at least ${policy.minLength} characters`);
    }
    if (policy.requireUppercase && !/[A-Z]/.test(password ?? '')) {
      unmet.push('Password must contain at least one uppercase letter');
    }
    if (policy.requireLowercase && !/[a-z]/.test(password ?? '')) {
      unmet.push('Password must contain at least one lowercase letter');
    }
    if (policy.requireNumber && !/[0-9]/.test(password ?? '')) {
      unmet.push('Password must contain at least one number');
    }
    if (policy.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password ?? '')) {
      unmet.push('Password must contain at least one special character');
    }

    return unmet;
  }

  private parseBool(key: string, defaultValue: boolean): boolean {
    const raw = this.config.get<string | boolean>(key);
    if (raw === undefined || raw === null) return defaultValue;
    if (typeof raw === 'boolean') return raw;
    return ['true', '1', 'yes'].includes(String(raw).toLowerCase());
  }
}
