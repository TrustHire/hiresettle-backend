import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsObject } from 'class-validator';

export class CreateSavedFilterDto {
  @ApiProperty({
    example: 'Active Engineering Roles',
    description: 'Human-readable preset name (unique per user)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: { status: 'ACTIVE', tags: 'engineering', search: 'senior' },
    description: 'Filter parameters to persist — same query-string shape as GET /engagements',
  })
  @IsObject()
  filters: Record<string, any>;
}
