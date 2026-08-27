import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Current account password' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ description: 'New password (must meet configured complexity policy)' })
  @IsString()
  @MinLength(1)
  newPassword: string;
}
