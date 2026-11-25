import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class BulkArchiveDto {
  @ApiProperty({ type: [String], description: 'Up to 100 engagement IDs to archive', maxItems: 100 })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  ids: string[];
}
