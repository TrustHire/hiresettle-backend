import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateProfileDto {
  @ApiProperty({ example: "Ada Lovelace", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ example: "HireSettle Inc.", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @ApiProperty({ example: "UTC", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  timezone?: string;

  @ApiProperty({ example: "ada@example.com", required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: "GABC...XYZ", required: false })
  @IsOptional()
  @IsString()
  stellarAddress?: string;

  @ApiProperty({ example: 'es', required: false, description: 'BCP-47 locale tag used for localized email templates (falls back to English)' })
  @IsOptional()
  @Matches(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/, {
    message: 'locale must be a BCP-47 tag such as "en" or "es"',
  })
  locale?: string;
}
