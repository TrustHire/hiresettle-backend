import {
  IsString, IsNotEmpty, IsOptional, IsObject,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEngagementTemplateDto {
  @ApiProperty({ example: 'Backend Engineer Standard' })
  @IsString() @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Senior Software Engineer' })
  @IsString() @IsNotEmpty()
  jobTitle: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  jobDescription?: string;

  @ApiProperty({ required: false, example: '$120k - $160k' })
  @IsOptional() @IsString()
  salaryRange?: string;

  @ApiProperty({ required: false, example: 'Remote' })
  @IsOptional() @IsString()
  location?: string;

  @ApiProperty({
    example: {
      milestones: [
        { name: 'Placement', paymentPercent: 50, kind: 'PLACEMENT' },
        { name: '90 Day Retention', paymentPercent: 50, kind: 'RETENTION' }
      ],
      retentionDays: [90]
    }
  })
  @IsObject() @IsNotEmpty()
  milestoneConfig: any;
}
