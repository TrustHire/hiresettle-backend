import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAINTENANCE_MODE_KEY = 'maintenance_mode';

@Injectable()
export class MaintenanceModeService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(): Promise<boolean> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: MAINTENANCE_MODE_KEY },
    });

    return config?.value === 'true';
  }

  async setEnabled(enabled: boolean) {
    await this.prisma.systemConfig.upsert({
      where: { key: MAINTENANCE_MODE_KEY },
      create: { key: MAINTENANCE_MODE_KEY, value: String(enabled) },
      update: { value: String(enabled) },
    });

    return { enabled };
  }
}