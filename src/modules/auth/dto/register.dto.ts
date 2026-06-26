import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'GABC...XYZ' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  stellarAddress?: string;

  @ApiPropertyOptional({ example: 'Ada Lovelace' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'HireSettle Inc.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  company?: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.COMPANY })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
