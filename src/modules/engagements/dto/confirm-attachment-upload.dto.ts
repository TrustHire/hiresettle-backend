import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmAttachmentUploadDto {
  @ApiProperty({
    description: 'The S3 key returned by POST .../attachments/upload-url',
    example: 'attachments/ENG-001/user-id/1735000000000-job-description.pdf',
  })
  @IsString()
  @IsNotEmpty()
  key: string;
}
