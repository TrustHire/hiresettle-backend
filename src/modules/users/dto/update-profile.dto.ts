import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Ada Lovelace', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ example: 'HireSettle Inc.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @ApiProperty({ example: 'ada@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'GABC...XYZ', required: false })
  @IsOptional()
  @IsString()
  stellarAddress?: string;
}
