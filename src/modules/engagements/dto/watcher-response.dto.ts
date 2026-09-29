import { ApiProperty } from '@nestjs/swagger';

export class WatcherResponseDto {
  @ApiProperty({ example: 'watcher_123' })
  id: string;

  @ApiProperty({ example: 'eng_abc123xyz' })
  engagementId: string;

  @ApiProperty({ example: 'user_456' })
  userId: string;

  @ApiProperty({ example: 'Jane Smith' })
  userName: string;

  @ApiProperty({ example: 'jane.smith@company.com' })
  userEmail: string;

  @ApiProperty({ example: 'user_789' })
  addedBy: string;

  @ApiProperty({ example: 'John Admin' })
  addedByName: string;

  @ApiProperty({ example: '2026-09-28T10:00:00Z' })
  createdAt: string;
}
