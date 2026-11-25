import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmProofUploadDto {
  @ApiProperty({
    description: 'The S3 object key returned by GET .../proof/upload-url',
    example: 'proofs/ENG-001/0/user-id/1735000000000.pdf',
  })
  @IsString()
  @IsNotEmpty()
  key: string;
}
