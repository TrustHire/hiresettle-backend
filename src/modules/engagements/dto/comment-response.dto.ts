import { ApiProperty } from '@nestjs/swagger';

export class CommentResponseDto {
  @ApiProperty({ example: 'c7a4e8d9-1234-5678-90ab-cdef12345678' })
  id: string;

  @ApiProperty({ example: 'eng_abc123xyz' })
  engagementId: string;

  @ApiProperty({ example: 'user_123' })
  authorId: string;

  @ApiProperty({ example: 'John Doe' })
  authorName: string;

  @ApiProperty({ example: 'The candidate has passed the technical interview.' })
  body: string;

  @ApiProperty({ example: '2026-09-28T12:30:00Z', required: false })
  editedAt?: string;

  @ApiProperty({ example: true, description: 'Whether the current user can edit this comment' })
  canEdit: boolean;

  @ApiProperty({ example: '2026-09-28T12:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-09-28T12:00:00Z' })
  updatedAt: string;
}
