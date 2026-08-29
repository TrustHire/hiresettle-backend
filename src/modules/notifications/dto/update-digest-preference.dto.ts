import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateDigestPreferenceDto {
  @ApiProperty({ description: 'Opt in (true) or opt out (false) of the weekly digest email' })
  @IsBoolean()
  digestEnabled: boolean;
}
