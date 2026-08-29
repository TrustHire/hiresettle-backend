import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { CacheService } from '../../common/cache/cache.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PublicUserDto } from './dto/public-user.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  private static readonly PROFILE_TTL_S = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly cache: CacheService,
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
    const cached = await this.cache?.get<PublicUserDto>(cacheKey);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { stellarAddress },
      select: { name: true, company: true, role: true, verifiedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');

    let averageRating: number | null | undefined;
    if (user.role === 'RECRUITER') {
      const avg = await this.prisma.recruiterReview.aggregate({
        where: { recruiterId: user.id },
        _avg: { rating: true },
      });
      averageRating =
        avg._avg.rating != null ? Math.round(avg._avg.rating * 10) / 10 : null;
    }

    const { id: _id, ...profile } = user;
    const result: PublicUserDto = { ...profile, ...(averageRating !== undefined ? { averageRating } : {}) };
    await this.cache?.set(cacheKey, result, UsersService.PROFILE_TTL_S);
    return result;
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
        locale: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    // Prevent stellarAddress modification
    if (dto.stellarAddress !== undefined) {
      throw new BadRequestException(
        'stellarAddress is immutable and cannot be updated',
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.company !== undefined && { company: dto.company }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
      },
      select: {
        name: true,
        email: true,
        company: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
        locale: true,
      },
    });

    return user;
  }

  async getAvatarUploadUrl(userId: string, contentType: string): Promise<{ uploadUrl: string; key: string }> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const key = `avatars/${userId}/${Date.now()}.${ext}`;
    const uploadUrl = await this.s3Service.getPresignedUploadUrl(key, contentType);
    // Store the key on the user record so the CDN URL is available after upload
    const cdnBase = process.env.S3_CDN_URL || process.env.S3_ENDPOINT;
    const avatarUrl = `${cdnBase}/${key}`;
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    // Note: old avatar key is not deleted here — cleanup of orphaned objects should
    // be handled by a scheduled S3 lifecycle rule or the s3-cleanup service.
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
    return { uploadUrl, key };
  }

  async updateAvatar(
    userId: string,
    avatarUrl: string,
  ): Promise<UserProfileDto> {
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
        locale: true,
      },
    });

    return user;
  }

  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UserProfileDto> {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG and PNG are allowed.',
      );
    }

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 2 MB limit.');
    }

    const fileExtension = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `avatars/${userId}/${Date.now()}.${fileExtension}`;

    await this.s3Service.uploadFile(key, file.buffer, file.mimetype);

    const cdnUrl = `${process.env.S3_CDN_URL || process.env.S3_ENDPOINT}/${key}`;

    return this.updateAvatar(userId, cdnUrl);
  }

  async getCustomFieldsConfig(userId: string): Promise<{ allowedCustomFields: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { allowedCustomFields: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return { allowedCustomFields: user.allowedCustomFields };
  }

  async updateCustomFieldsConfig(userId: string, allowedCustomFields: string[]): Promise<{ allowedCustomFields: string[] }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { allowedCustomFields },
      select: { allowedCustomFields: true },
    });
    return { allowedCustomFields: user.allowedCustomFields };
  }
}
