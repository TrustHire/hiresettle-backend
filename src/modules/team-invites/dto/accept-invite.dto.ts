import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty({ example: 'Jane Doe', description: 'Display name for the new account' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'securePassword123!', description: 'Password for the new account' })
  @IsString()
  @MinLength(8)
  password: string;
}
