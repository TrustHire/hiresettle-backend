import { Module } from '@nestjs/common';
import { RecruitersController } from './recruiters.controller';
import { RecruitersService } from './recruiters.service';
import { KycService } from './kyc.service';
import { RecruiterReviewsService } from './recruiter-reviews.service';
import { FavoritesService } from './favorites.service';
import { S3Module } from '../../common/s3/s3.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [S3Module, PrismaModule],
  controllers: [RecruitersController],
  providers: [RecruitersService, KycService, RecruiterReviewsService, FavoritesService],
  exports: [RecruitersService, KycService, RecruiterReviewsService, FavoritesService],
})
export class RecruitersModule {}
