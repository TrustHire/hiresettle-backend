import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { GdprService } from './gdpr.service';
import { PiiAnonymizationSchedulerService } from './pii-anonymization-scheduler.service';
import { S3Module } from '../../common/s3/s3.module';
import { AppCacheModule } from '../../common/cache/cache.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [S3Module, AppCacheModule, AuthModule],
  providers: [UsersService, GdprService, PiiAnonymizationSchedulerService],
  controllers: [UsersController],
  exports: [UsersService, GdprService],
})
export class UsersModule {}
