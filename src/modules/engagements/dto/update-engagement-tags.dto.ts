import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMaxSize } from 'class-validator';

export class UpdateEngagementTagsDto {
  @ApiProperty({
    type: [String],
    example: ['engineering', 'urgent'],
    description: 'Full replacement list of tags for the engagement (max 20, each max 50 chars)',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  tags: string[];
}
