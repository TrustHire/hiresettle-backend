import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { FriendbotService } from './friendbot.service';

@Module({
  controllers: [DevController],
  providers: [FriendbotService],
})
export class DevModule {}
