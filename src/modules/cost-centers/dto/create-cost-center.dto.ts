import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCostCenterDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'ENG-001', description: 'Unique cost center code within the company' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code must contain only letters, numbers, hyphens, or underscores',
  })
  code: string;

  @ApiProperty({
    example: '5000000000',
    description: 'Department budget in integer base units (stroops)',
  })
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/, { message: 'budget must be a positive integer string' })
  budget: string;
}
