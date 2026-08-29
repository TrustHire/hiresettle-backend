import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UserProfileDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  name: string | null;

  @ApiProperty({ example: 'ada@example.com' })
  email: string | null;

  @ApiProperty({ example: 'HireSettle Inc.' })
  company: string | null;

  @ApiProperty({ example: 'GABC...XYZ' })
  stellarAddress: string | null;

  @ApiProperty({ example: 'https://cdn.example.com/avatars/abc123.jpg', required: false })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ example: 'https://hooks.slack.com/services/<team-id>/<webhook-id>/<token>', required: false, description: 'Slack incoming-webhook URL for notification alerts' })
  slackWebhookUrl: string | null;
}
