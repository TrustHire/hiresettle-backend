import { Global, Module } from '@nestjs/common';
import { SecurityEventsService } from './security-events.service';

@Global()
@Module({
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
