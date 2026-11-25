import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsIn, IsNumberString, IsNumber, Min, Max } from 'class-validator';

const ALLOWED = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export class RequestAttachmentUploadDto {
  @ApiProperty({
    description: 'Original file name, e.g. "job-description.pdf"',
    example: 'job-description.pdf',
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    description: 'MIME type of the file',
    enum: ALLOWED,
    example: 'application/pdf',
  })
  @IsString()
  @IsIn(ALLOWED, {
    message: `mimeType must be one of: ${ALLOWED.join(', ')}`,
  })
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes (must be ≤ 10 MB)', example: 204800 })
  @IsNumber()
  @Min(1)
  @Max(10 * 1024 * 1024)
  fileSize: number;
}
