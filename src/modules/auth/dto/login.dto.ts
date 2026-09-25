import { IsEmail, IsString, IsNotEmpty, IsOptional, IsBoolean, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'TOTP code for 2FA (required if 2FA is enabled and no trusted device)', required: false })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  totpCode?: string;

  @ApiProperty({ description: 'Single-use backup recovery code (accepted instead of totpCode)', required: false })
  @IsOptional()
  @IsString()
  recoveryCode?: string;

  @ApiProperty({ description: 'Set to true to issue a trusted-device token that skips 2FA for the configured period', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  trustDevice?: boolean;

  @ApiProperty({ description: 'Previously issued trusted-device token; if valid 2FA is skipped', required: false })
  @IsOptional()
  @IsString()
  trustedDeviceToken?: string;
}
