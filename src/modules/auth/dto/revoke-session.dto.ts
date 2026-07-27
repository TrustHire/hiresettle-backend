import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RevokeSessionDto {
  @ApiProperty({
    description: 'Current refresh token to detect if revoked session is the current one',
    required: false,
  })
  @IsOptional()
  @IsString()
  currentRefreshToken?: string;
}
