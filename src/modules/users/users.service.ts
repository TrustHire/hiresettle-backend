import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PublicUserDto } from './dto/public-user.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CacheService } from '../../common/cache/cache.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

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

  async findByStellarAddress(stellarAddress: string): Promise<PublicUserDto> {
    const cacheKey = `user:profile:${stellarAddress}`;
    const cached = await this.cache.get<PublicUserDto>(cacheKey);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { stellarAddress },
      select: { name: true, company: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.cache.set(cacheKey, user, UsersService.PROFILE_TTL_S);
    return user;
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

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        company: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfileDto> {
    // Prevent stellarAddress modification
    if (dto.stellarAddress !== undefined) {
      throw new BadRequestException('stellarAddress is immutable and cannot be updated');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.company !== undefined && { company: dto.company }),
        ...(dto.email !== undefined && { email: dto.email }),
      },
      select: {
        name: true,
        email: true,
        company: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
      },
    });

    return user;
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        name: true,
        email: true,
        company: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
      },
    });

    return user;
  }

  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<UserProfileDto> {
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG and PNG are allowed.');
    }

    // Validate file size (2 MB = 2 * 1024 * 1024 bytes)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 2 MB limit.');
    }

    // Generate unique key for S3
    const fileExtension = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `avatars/${userId}/${Date.now()}.${fileExtension}`;

    // Upload to S3
    await this.s3Service.uploadFile(key, file.buffer, file.mimetype);

    // Generate CDN URL (assuming S3 endpoint is the CDN URL)
    const cdnUrl = `${process.env.S3_CDN_URL || process.env.S3_ENDPOINT}/${key}`;

    // Update user's avatar URL
    return this.updateAvatar(userId, cdnUrl);
  }
}
