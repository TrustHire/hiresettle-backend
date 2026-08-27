import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class PublicUserDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  name: string | null;

  @ApiProperty({ example: 'HireSettle Inc.' })
  company: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({
    example: 4.5,
    required: false,
    nullable: true,
    description: 'Average recruiter rating (recruiters only)',
  })
  averageRating?: number | null;
}
