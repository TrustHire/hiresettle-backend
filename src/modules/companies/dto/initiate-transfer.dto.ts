import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class InitiateTransferDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'User ID of the existing company member who will become the new owner',
  })
  @IsUUID()
  newOwnerId: string;
}
