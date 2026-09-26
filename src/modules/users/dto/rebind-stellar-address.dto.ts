import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

export class RebindStellarAddressDto {
  @ApiProperty({
    example: 'GNEWADDRESS...',
    description: 'The new Stellar public key (G… 56 chars) to link to this account',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(STELLAR_ADDRESS_RE, { message: 'newAddress must be a valid Stellar public key' })
  newAddress: string;

  @ApiProperty({
    description:
      'The nonce obtained from GET /auth/rebind-challenge, signed with the NEW private key ' +
      'and base64-encoded (64-byte Ed25519 signature)',
  })
  @IsString()
  @IsNotEmpty()
  newSignature: string;

  @ApiProperty({
    description:
      'The same nonce signed with the OLD private key and base64-encoded. ' +
      'Required if the account already has a linked Stellar address.',
  })
  @IsString()
  @IsNotEmpty()
  nonce: string;

  @ApiPropertyOptional({
    description:
      'The same nonce signed with the OLD private key and base64-encoded. ' +
      'Required when the account already has a linked Stellar address.',
  })
  @IsString()
  oldSignature?: string;
}
