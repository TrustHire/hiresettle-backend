import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableTotpDto {
  @ApiProperty({ description: '6-digit TOTP code from authenticator app', example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class DisableTotpDto {
  @ApiProperty({ description: '6-digit TOTP code from authenticator app', example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class TotpSecretResponseDto {
  @ApiProperty({ description: 'Base32 encoded TOTP secret (only shown once during enrollment)' })
  secret: string;

  @ApiProperty({ description: 'otpauth:// URL for QR code generation' })
  otpauthUrl: string;
}

export class TotpStatusResponseDto {
  @ApiProperty({ description: 'Whether 2FA is enabled for the account' })
  enabled: boolean;
}
