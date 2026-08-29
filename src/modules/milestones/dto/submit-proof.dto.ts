import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitProofDto {
  @ApiProperty({ description: 'The IPFS hash or URL link containing proof documentation' })
  @IsNotEmpty()
  @IsString()
  proofHash: string;
}
