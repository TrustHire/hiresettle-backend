import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum } from 'class-validator';

export class PreferenceItemDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty()
  @IsBoolean()
  emailEnabled: boolean;
}

export class UpdatePreferencesDto {
  @ApiProperty({ type: [PreferenceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences: PreferenceItemDto[];
}
