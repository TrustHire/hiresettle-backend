import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { CacheService } from '../../common/cache/cache.service';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  notificationPreference: { findMany: jest.fn(), upsert: jest.fn() },
};

const mockS3Service = {
  uploadFile: jest.fn(),
};

const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3Service, useValue: mockS3Service },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findByStellarAddress()', () => {
    const address =
      'GABC123DEFGHIJKLMNOPQRSTUVWXYZ234567GABC123DEFGHIJKLMNOPQR';

    it('returns public fields when user exists', async () => {
      const mockUser = {
        name: 'Ada',
        company: 'HireSettle',
        role: UserRole.RECRUITER,
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByStellarAddress(address);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { stellarAddress: address },
        select: { name: true, company: true, role: true },
      });
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findByStellarAddress(address)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getProfile()', () => {
    const userId = 'user-123';

    it('returns user profile when user exists', async () => {
      const mockUser = {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'HireSettle Inc.',
        stellarAddress:
          'GABC123DEFGHIJKLMNOPQRSTUVWXYZ234567GABC123DEFGHIJKLMNOPQR',
        avatarUrl: null,
        role: UserRole.COMPANY,
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile(userId);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
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
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile()', () => {
    const userId = 'user-123';

    it('updates name, company, and email successfully', async () => {
      const mockUser = {
        name: 'Updated Name',
        email: 'updated@example.com',
        company: 'Updated Company',
        stellarAddress:
          'GABC123DEFGHIJKLMNOPQRSTUVWXYZ234567GABC123DEFGHIJKLMNOPQR',
        avatarUrl: null,
        role: UserRole.COMPANY,
      };
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const dto = {
        name: 'Updated Name',
        company: 'Updated Company',
        email: 'updated@example.com',
      };
      const result = await service.updateProfile(userId, dto);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          name: 'Updated Name',
          company: 'Updated Company',
          email: 'updated@example.com',
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
    });

    it('throws BadRequestException when stellarAddress is provided', async () => {
      const dto = {
        stellarAddress:
          'GABC123DEFGHIJKLMNOPQRSTUVWXYZ234567GABC123DEFGHIJKLMNOPQR',
      };
      await expect(service.updateProfile(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('uploadAvatar()', () => {
    const userId = 'user-123';
    const mockFile = {
      buffer: Buffer.from('test'),
      mimetype: 'image/jpeg',
      size: 1024,
    } as Express.Multer.File;

    it('uploads avatar successfully', async () => {
      const mockUser = {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'HireSettle Inc.',
        stellarAddress:
          'GABC123DEFGHIJKLMNOPQRSTUVWXYZ234567GABC123DEFGHIJKLMNOPQR',
        avatarUrl: 'https://cdn.example.com/avatars/user-123/1234567890.jpg',
        role: UserRole.COMPANY,
      };
      mockS3Service.uploadFile.mockResolvedValue(
        'avatars/user-123/1234567890.jpg',
      );
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const result = await service.uploadAvatar(userId, mockFile);

      expect(mockS3Service.uploadFile).toHaveBeenCalled();
      expect(result.avatarUrl).toBeTruthy();
    });

    it('throws BadRequestException for invalid file type', async () => {
      const invalidFile = {
        ...mockFile,
        mimetype: 'application/pdf',
      } as Express.Multer.File;
      await expect(service.uploadAvatar(userId, invalidFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for file size exceeding 2 MB', async () => {
      const largeFile = {
        ...mockFile,
        size: 3 * 1024 * 1024,
      } as Express.Multer.File;
      await expect(service.uploadAvatar(userId, largeFile)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
