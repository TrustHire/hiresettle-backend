import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ 
    example: 'The candidate has passed the technical interview and is ready to proceed.',
    description: 'Comment body visible to both company and recruiter'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;
}
