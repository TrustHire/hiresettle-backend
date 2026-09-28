import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddWatcherDto {
  @ApiProperty({ 
    example: 'user_abc123',
    description: 'User ID of the company member to add as a watcher'
  })
  @IsString()
  @IsNotEmpty()
  userId: string;
}
