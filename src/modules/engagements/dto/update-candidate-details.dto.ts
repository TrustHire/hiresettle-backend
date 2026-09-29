import { IsOptional, IsString, IsDateString, MaxLength, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCandidateDetailsDto {
  @ApiProperty({ 
    example: 'Jane Smith',
    description: 'Name of the placed candidate',
    required: false
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  candidateName?: string;

  @ApiProperty({ 
    example: 'jane.smith@example.com',
    description: 'Email of the placed candidate',
    required: false
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  candidateEmail?: string;

  @ApiProperty({ 
    example: '+1-555-0123',
    description: 'Phone number of the placed candidate',
    required: false
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  candidatePhone?: string;

  @ApiProperty({ 
    example: '2026-10-15',
    description: 'Start date of the placed candidate (ISO 8601 date)',
    required: false
  })
  @IsOptional()
  @IsDateString()
  candidateStartDate?: string;

  @ApiProperty({ 
    example: 'Senior Software Engineer',
    description: 'Role of the placed candidate',
    required: false
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  candidateRole?: string;
}
