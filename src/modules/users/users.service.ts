import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(userId: string) {
    const saved = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });

    // Return one entry per type, defaulting emailEnabled to true
    return Object.values(NotificationType).map((type) => {
      const pref = saved.find((p) => p.type === type);
      return { type, emailEnabled: pref ? pref.emailEnabled : true };
    });
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    await Promise.all(
      dto.preferences.map(({ type, emailEnabled }) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type } },
          update: { emailEnabled },
          create: { userId, type, emailEnabled },
        }),
      ),
    );
    return this.getPreferences(userId);
  }
}
