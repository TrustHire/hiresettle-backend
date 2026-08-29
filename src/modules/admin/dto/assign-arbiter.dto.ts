import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AssignArbiterDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  arbiterId: string;
}
