import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgencyRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';

export class InviteAgencyMemberDto {
  @ApiProperty({ example: 'recruiter@apextalent.example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: AgencyRole, default: AgencyRole.RECRUITER })
  @IsOptional()
  @IsEnum(AgencyRole)
  role?: AgencyRole;
}
