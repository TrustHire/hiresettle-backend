import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { S3CleanupService } from './s3-cleanup.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [S3Service, S3CleanupService],
  exports: [S3Service],
})
export class S3Module {}
