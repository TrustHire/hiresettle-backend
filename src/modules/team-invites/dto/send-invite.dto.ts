import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendInviteDto {
  @ApiProperty({ example: 'colleague@example.com', description: 'Email address of the person to invite' })
  @IsEmail()
  email: string;
}
