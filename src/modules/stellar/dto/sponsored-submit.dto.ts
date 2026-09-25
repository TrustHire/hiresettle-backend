import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SponsoredSubmitDto {
  @ApiProperty({ description: 'Base64 XDR of the user-signed transaction' })
  @IsString()
  @IsNotEmpty()
  xdr: string;

  @ApiProperty({ description: 'Company billed for the sponsored fee' })
  @IsString()
  @IsNotEmpty()
  companyId: string;
}
