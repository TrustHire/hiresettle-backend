import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OpenAppealDto {
  @ApiProperty({ description: 'Why the decision should be reviewed', maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
