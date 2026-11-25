import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { RequestAttachmentUploadDto } from './dto/request-attachment-upload.dto';

/** Short-lived download URL expiry: 15 minutes. */
const DOWNLOAD_URL_TTL_SECONDS = 900;

@Injectable()
export class EngagementAttachmentsService {
  private readonly logger = new Logger(EngagementAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /**
   * Step 1 — returns a presigned PUT URL for the caller to upload a JD/attachment directly to S3.
   * Validates MIME type and declared file size before issuing the URL.
   * Any participant (company, recruiter, arbiter) may upload.
   */
  async requestUploadUrl(
    engagementId: string,
    user: { id: string; stellarAddress?: string; role: UserRole },
    dto: RequestAttachmentUploadDto,
  ) {
    const engagement = await this.requireEngagement(engagementId);
    this.checkParticipant(engagement, user);

    const safeName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `attachments/${engagementId}/${user.id}/${Date.now()}-${safeName}`;
    const expiresIn = 900; // 15 minutes

    // S3Service validates mimeType against the attachment allowlist
    const uploadUrl = await this.s3.getPresignedAttachmentUploadUrl(key, dto.mimeType, expiresIn);

    return { uploadUrl, key, expiresIn };
  }

  /**
   * Step 2 — called after the client PUT the file to S3.
   * Verifies the actual Content-Type and size of the uploaded object,
   * then persists the attachment metadata to the database.
   */
  async confirmUpload(
    engagementId: string,
    user: { id: string; stellarAddress?: string; role: UserRole },
    key: string,
  ) {
    const engagement = await this.requireEngagement(engagementId);
    this.checkParticipant(engagement, user);

    // Verify type + size; throws and auto-deletes the S3 object on violation
    const { contentType, size } = await this.s3.verifyUpload(
      key,
      S3Service.ATTACHMENT_ALLOWED_MIME_TYPES,
      S3Service.MAX_UPLOAD_BYTES,
    );

    // Extract original file name from the key path
    const fileName = key.split('/').pop() ?? key;

    const attachment = await this.prisma.engagementAttachment.create({
      data: {
        engagementId,
        uploadedBy: user.id,
        fileName,
        mimeType: contentType,
        fileSize: size,
        s3Key: key,
      },
    });

    this.logger.log(
      `Attachment ${attachment.id} confirmed for engagement ${engagementId} by user ${user.id}`,
    );
    return attachment;
  }

  /**
   * List all attachments for an engagement. Participants only.
   */
  async list(
    engagementId: string,
    user: { id: string; stellarAddress?: string; role: UserRole },
  ) {
    const engagement = await this.requireEngagement(engagementId);
    this.checkParticipant(engagement, user);

    return this.prisma.engagementAttachment.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Returns a short-lived (15-minute) presigned download URL for an attachment.
   * Only participants can download.
   */
  async getDownloadUrl(
    engagementId: string,
    attachmentId: string,
    user: { id: string; stellarAddress?: string; role: UserRole },
  ) {
    const engagement = await this.requireEngagement(engagementId);
    this.checkParticipant(engagement, user);

    const attachment = await this.prisma.engagementAttachment.findFirst({
      where: { id: attachmentId, engagementId },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment ${attachmentId} not found on engagement ${engagementId}`);
    }

    const url = await this.s3.getPresignedUrl(attachment.s3Key, DOWNLOAD_URL_TTL_SECONDS);
    return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS, fileName: attachment.fileName };
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private async requireEngagement(engagementId: string) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }
    return engagement;
  }

  private checkParticipant(
    engagement: { companyAddress: string; recruiterAddress: string; arbiterAddress: string },
    user: { stellarAddress?: string; role: UserRole },
  ) {
    if (user.role === UserRole.ADMIN) return;
    const parties = [engagement.companyAddress, engagement.recruiterAddress, engagement.arbiterAddress];
    if (!user.stellarAddress || !parties.includes(user.stellarAddress)) {
      throw new ForbiddenException('Only engagement participants can manage attachments');
    }
  }
}
