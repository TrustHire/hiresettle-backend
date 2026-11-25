import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AtsProvider } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAtsIntegrationDto {
  @ApiProperty({ enum: AtsProvider })
  @IsEnum(AtsProvider)
  provider: AtsProvider;

  @ApiPropertyOptional({
    description:
      'Webhook signing secret. Required for Lever (the signature token shown in Lever). ' +
      'Optional for Greenhouse — one is generated when omitted; paste it into Greenhouse as the secret key.',
  })
  @IsOptional() @IsString() @MinLength(16) @MaxLength(256)
  secret?: string;
}

export class RotateAtsSecretDto {
  @ApiPropertyOptional({ description: 'New secret. Generated when omitted (Greenhouse only).' })
  @IsOptional() @IsString() @MinLength(16) @MaxLength(256)
  secret?: string;
}

export class CreateAtsMappingDto {
  @ApiProperty({ description: 'HireSettle engagement to advance when the candidate is hired' })
  @IsString() @IsNotEmpty()
  engagementId: string;

  @ApiPropertyOptional({ description: 'ATS job / posting id. Omit to match the candidate on any job.' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128)
  externalJobId?: string;

  @ApiPropertyOptional({ description: 'ATS candidate id (Lever: opportunity id). Omit to match any hire on the job.' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128)
  externalCandidateId?: string;
}
