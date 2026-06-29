// src/modules/engagements/dto/request-replacement.dto.ts
//
// Body DTO for POST /engagements/:id/request-replacement
// The company may optionally supply a short reason (≤ 500 chars)
// explaining why a replacement candidate is needed.

import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestReplacementDto {
  @ApiProperty({
    required: false,
    maxLength: 500,
    example: 'Candidate skills did not match the role requirements after onboarding.',
    description: 'Optional reason for requesting a candidate replacement (max 500 characters)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}