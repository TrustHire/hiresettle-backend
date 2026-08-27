import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenanceModeGuard } from './maintenance-mode.guard';
import { MaintenanceModeService } from './maintenance-mode.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    MaintenanceModeService,
    {
      provide: APP_GUARD,
      useClass: MaintenanceModeGuard,
    },
  ],
  exports: [MaintenanceModeService],
})
export class MaintenanceModeModule {}