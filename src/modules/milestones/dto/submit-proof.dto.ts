import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RequirementEvidenceDto {
  @ApiProperty({ example: 'Signed offer letter', description: 'Must match one of the milestone\'s proofRequirements' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  requirement: string;

  @ApiPropertyOptional({ description: 'Link to the document that satisfies this requirement' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'Explanation, when there is no document to link' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class SubmitProofDto {
  @ApiPropertyOptional({ description: 'Link to the proof document (e.g. signed offer letter)' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'Free-text proof or notes for the reviewer', maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ description: 'Hash of the proof document, matching the on-chain submission' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  proofHash?: string;

  @ApiPropertyOptional({
    type: [RequirementEvidenceDto],
    description: 'One entry per milestone proof requirement; every requirement must be covered by a proofUrl or note.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RequirementEvidenceDto)
  requirements?: RequirementEvidenceDto[];
}
