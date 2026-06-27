import { Module } from '@nestjs/common';
import { EngagementsController } from './engagements.controller';
import { EngagementsService } from './engagements.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [NotificationsModule, AdminModule, PrismaModule],
  controllers: [EngagementsController],
  providers: [EngagementsService],
  exports: [EngagementsService],
})
export class EngagementsModule {}
