import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateApplicationDto {
  @IsString()
  @MaxLength(2000)
  pitchMessage: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  proposedFee?: number;
}
