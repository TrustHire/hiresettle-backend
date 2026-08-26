import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class AvatarUploadDto {
  @ApiProperty({ example: 'image/jpeg', enum: ['image/jpeg', 'image/png', 'image/jpg'] })
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/jpg'])
  contentType: string;
}
