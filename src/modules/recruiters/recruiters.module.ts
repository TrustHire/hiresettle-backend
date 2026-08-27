import { Module } from '@nestjs/common';
import { RecruitersController } from './recruiters.controller';
import { RecruitersService } from './recruiters.service';
import { KycService } from './kyc.service';
import { RecruiterReviewsService } from './recruiter-reviews.service';
import { S3Module } from '../../common/s3/s3.module';

@Module({
  imports: [S3Module],
  controllers: [RecruitersController],
  providers: [RecruitersService, KycService, RecruiterReviewsService],
  exports: [RecruitersService, KycService, RecruiterReviewsService],
})
export class RecruitersModule {}
