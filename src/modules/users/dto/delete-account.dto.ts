import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Re-authentication payload for self-service account deletion.
 * Provide either password (email accounts) or a signed challenge nonce (wallet accounts).
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'Account password (required if no signature)' })
  @ValidateIf((o) => !o.signature)
  @IsString()
  password?: string;

  @ApiPropertyOptional({
    description: 'Base64-encoded signature of the challenge nonce for the user Stellar address',
  })
  @ValidateIf((o) => !o.password)
  @IsString()
  signature?: string;

  @ApiPropertyOptional({
    description: 'Challenge nonce previously issued by GET /auth/challenge (required with signature)',
  })
  @ValidateIf((o) => !!o.signature)
  @IsOptional()
  @IsString()
  nonce?: string;
}
