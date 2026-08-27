import { ApiProperty } from '@nestjs/swagger';
import { UserProfileDto } from './user-profile.dto';

export class UserDataExportDto {
  @ApiProperty({ description: 'ISO timestamp when the export was generated' })
  exportedAt: string;

  @ApiProperty({ type: UserProfileDto })
  profile: UserProfileDto;

  @ApiProperty({
    description: 'Engagements where the user is a party (by address or user id)',
    type: 'array',
    items: { type: 'object' },
  })
  engagements: unknown[];

  @ApiProperty({
    description: 'In-app notifications owned by the requester',
    type: 'array',
    items: { type: 'object' },
  })
  notifications: unknown[];
}
