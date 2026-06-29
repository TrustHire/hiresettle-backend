import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { S3Module } from '../../common/s3/s3.module';
import { CacheModule } from '../../common/cache/cache.module';

@Module({
  imports: [S3Module, CacheModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
