import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class PublicUserDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  name: string | null;

  @ApiProperty({ example: 'HireSettle Inc.' })
  company: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ nullable: true, description: 'When the company was verified by an admin' })
  verifiedAt: Date | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Recruiting agency affiliation, if the recruiter belongs to an agency (#549)',
  })
  agency?: { id: string; name: string; slug: string; role: string } | null;
}
