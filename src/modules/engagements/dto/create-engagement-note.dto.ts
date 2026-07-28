import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEngagementNoteDto {
  @ApiProperty({ example: 'Candidate accepted the offer, starting Monday.' })
  @IsString() @IsNotEmpty() @MaxLength(4000)
  body: string;
}
