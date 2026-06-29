// src/modules/engagements/dto/cancel-engagement.dto.ts
//
// Body DTO for POST /engagements/:id/cancel
// The body is intentionally empty — the company triggers a cancel
// with no extra payload. We define the class anyway so Swagger
// picks it up and so future additions (e.g. a reason field) have a
// clear home.

import { ApiProperty } from '@nestjs/swagger';

export class CancelEngagementDto {
  // Reserved for future use (e.g. an optional cancellation reason).
  // Currently no fields are required.
  @ApiProperty({
    required: false,
    example: 'Candidate withdrew before start date.',
    description: 'Optional human-readable reason for cancellation (not persisted to DB in v1, logged only)',
  })
  reason?: string;
}