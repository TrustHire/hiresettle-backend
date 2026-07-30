import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { GdprService } from './gdpr.service';
import { S3Module } from '../../common/s3/s3.module';
import { AppCacheModule } from '../../common/cache/cache.module';

@Module({
  imports: [S3Module, AppCacheModule],
  providers: [UsersService, GdprService],
  controllers: [UsersController],
  exports: [UsersService, GdprService],
})
export class UsersModule {}
