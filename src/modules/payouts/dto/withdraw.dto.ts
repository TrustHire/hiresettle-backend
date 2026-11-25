import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class WithdrawChallengeDto {
  @ApiProperty({ description: 'Anchor id from GET /payouts/anchors', example: 'moneygram' })
  @IsString()
  @MaxLength(64)
  anchorId: string;
}

export class WithdrawDto {
  @ApiProperty({ description: 'Anchor id from GET /payouts/anchors', example: 'moneygram' })
  @IsString()
  @MaxLength(64)
  anchorId: string;

  @ApiProperty({
    description:
      'SEP-10 challenge from POST /payouts/withdraw/challenge, signed by the recruiter wallet (base64 XDR)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  signedChallenge: string;

  @ApiPropertyOptional({ description: 'Asset code to withdraw', default: 'USDC' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,12}$/)
  assetCode?: string;

  @ApiPropertyOptional({ description: 'Amount to withdraw in asset units; the anchor form asks if omitted', example: '250.00' })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,7})?$/, { message: 'amount must be a positive decimal with at most 7 places' })
  amount?: string;

  @ApiPropertyOptional({ description: 'Language for the anchor UI (RFC 4646)', example: 'en' })
  @IsOptional()
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/)
  lang?: string;
}
