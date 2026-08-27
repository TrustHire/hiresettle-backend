import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class SetCompanyVerificationDto {
  @ApiProperty({ description: "Whether the company is verified" })
  @IsBoolean()
  verified: boolean;
}
