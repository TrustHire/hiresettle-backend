import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsOptional, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class NotificationPreferenceItemDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ required: false, description: 'Receive this notification type by email' })
  @IsOptional() @IsBoolean()
  emailEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Show this notification type in-app' })
  @IsOptional() @IsBoolean()
  inAppEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Push this notification type over the SSE stream' })
  @IsOptional() @IsBoolean()
  sseEnabled?: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceItemDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences: NotificationPreferenceItemDto[];
}
