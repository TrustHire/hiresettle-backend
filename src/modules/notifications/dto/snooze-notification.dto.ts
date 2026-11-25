import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class SnoozeNotificationDto {
  @ApiProperty({
    example: '2026-12-01T09:00:00.000Z',
    description: 'ISO 8601 datetime — notification will be hidden until this time',
  })
  @IsDateString()
  until: string;
}
