import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SetProofRequirementsDto {
  @ApiProperty({ example: ['Signed offer letter', 'Start-date confirmation'], type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  proofRequirements: string[];
}
