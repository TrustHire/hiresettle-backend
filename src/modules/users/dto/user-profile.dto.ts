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
}
