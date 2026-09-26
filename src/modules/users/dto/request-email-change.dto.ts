import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'new@example.com', description: 'The new email address to associate with the account' })
  @IsEmail()
  newEmail: string;
}
