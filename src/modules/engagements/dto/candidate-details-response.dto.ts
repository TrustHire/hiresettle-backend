import { ApiProperty } from '@nestjs/swagger';

export class CandidateDetailsResponseDto {
  @ApiProperty({ example: 'Jane Smith', required: false })
  candidateName?: string;

  @ApiProperty({ example: 'jane.smith@example.com', required: false })
  candidateEmail?: string;

  @ApiProperty({ example: '+1-555-0123', required: false })
  candidatePhone?: string;

  @ApiProperty({ example: '2026-10-15T00:00:00Z', required: false })
  candidateStartDate?: string;

  @ApiProperty({ example: 'Senior Software Engineer', required: false })
  candidateRole?: string;

  @ApiProperty({ example: '2026-09-28T14:30:00Z', required: false, description: 'When the candidate details were recorded' })
  placedAt?: string;
}
