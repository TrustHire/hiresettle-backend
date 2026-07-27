import { IsEmail, IsString, IsNotEmpty, IsOptional, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'TOTP code for 2FA (required if 2FA is enabled)', required: false })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  totpCode?: string;
}
