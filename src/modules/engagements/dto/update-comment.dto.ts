import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCommentDto {
  @ApiProperty({ 
    example: 'Updated: The candidate has completed all requirements.',
    description: 'Updated comment body (can only edit within 15 minutes of creation)'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;
}
