import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';

const ALLOWED_KYC_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
];
const MAX_KYC_FILE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async getMyKyc(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        kycStatus: true,
        kycReviewedAt: true,
        kycReviewedBy: true,
        kycRejectionReason: true,
        kycDocuments: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            s3Path: true,
            uploadedAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.RECRUITER) {
      throw new ForbiddenException('KYC is only available for recruiter accounts');
    }
    return user;
  }

  async submitDocument(userId: string, file: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.RECRUITER) {
      throw new ForbiddenException('Only recruiters can submit KYC documents');
    }
    if (user.kycStatus === KycStatus.APPROVED) {
      throw new BadRequestException('KYC is already approved');
    }
    if (!ALLOWED_KYC_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${ALLOWED_KYC_MIME_TYPES.join(', ')}`,
      );
    }
    if (file.size > MAX_KYC_FILE_BYTES) {
      throw new BadRequestException('File size exceeds 10 MB limit');
    }

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `kyc/${userId}/${Date.now()}-${safeName}`;
    await this.s3.uploadFile(key, file.buffer, file.mimetype);
    const s3Url = await this.s3.getPresignedUrl(key);

    const [document] = await this.prisma.$transaction([
      this.prisma.kycDocument.create({
        data: {
          userId,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          s3Path: key,
          s3Url,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          kycStatus: KycStatus.PENDING,
          kycRejectionReason: null,
          kycReviewedAt: null,
          kycReviewedBy: null,
        },
      }),
    ]);

    return document;
  }

  async listPending(page = 1, limit = 20) {
    const where = { role: UserRole.RECRUITER, kycStatus: KycStatus.PENDING };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          stellarAddress: true,
          kycStatus: true,
          createdAt: true,
          kycDocuments: {
            orderBy: { uploadedAt: 'desc' },
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              fileSize: true,
              s3Path: true,
              uploadedAt: true,
            },
          },
        },
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async approve(userId: string, adminId: string) {
    return this.review(userId, adminId, KycStatus.APPROVED);
  }

  async reject(userId: string, adminId: string, reason?: string) {
    return this.review(userId, adminId, KycStatus.REJECTED, reason);
  }

  private async review(
    userId: string,
    adminId: string,
    status: typeof KycStatus.APPROVED | typeof KycStatus.REJECTED,
    reason?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.RECRUITER) {
      throw new BadRequestException('User is not a recruiter');
    }
    if (user.kycStatus !== KycStatus.PENDING) {
      throw new BadRequestException(`KYC is not pending (current: ${user.kycStatus})`);
    }

    const docCount = await this.prisma.kycDocument.count({ where: { userId } });
    if (docCount === 0) {
      throw new BadRequestException('No KYC documents submitted');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: status,
        kycReviewedAt: new Date(),
        kycReviewedBy: adminId,
        kycRejectionReason: status === KycStatus.REJECTED ? (reason ?? null) : null,
      },
      select: {
        id: true,
        kycStatus: true,
        kycReviewedAt: true,
        kycReviewedBy: true,
        kycRejectionReason: true,
      },
    });
  }
}
