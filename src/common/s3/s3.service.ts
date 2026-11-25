import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private s3: S3Client;
  private bucket: string;
  private defaultPresignedUrlExpiry: number;

  constructor(private configService: ConfigService) {
    this.s3 = new S3Client({
      region: this.configService.get<string>('S3_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('S3_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>('S3_SECRET_ACCESS_KEY')!,
      },
      endpoint: this.configService.get<string>('S3_ENDPOINT'),
    });
    this.bucket = this.configService.get<string>('S3_BUCKET')!;
    this.defaultPresignedUrlExpiry = this.configService.get<number>('S3_PRESIGNED_URL_EXPIRY', 3600);
  }

  async uploadFile(
    key: string,
    body: Buffer,
    mimeType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    });
    await this.s3.send(command);
    return key;
  }

  async getPresignedUrl(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedUrl(this.s3, command, { expiresIn: expiresIn ?? this.defaultPresignedUrlExpiry });
  }

  async getPresignedUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return await getSignedUrl(this.s3, command, { expiresIn: expiresIn ?? this.defaultPresignedUrlExpiry });
  }

  /** MIME types accepted for proof and JD/attachment uploads. */
  static readonly ATTACHMENT_ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  ];

  /** MIME types accepted for proof file uploads (PDF + common images). */
  static readonly PROOF_ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  /** Maximum size for proof or attachment uploads: 10 MB. */
  static readonly MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

  /**
   * Returns a presigned PUT URL restricted to allowed proof MIME types (PDF + images) and 10 MB max.
   * Throws BadRequestException immediately for disallowed contentType.
   */
  async getPresignedProofUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string> {
    if (!S3Service.PROOF_ALLOWED_MIME_TYPES.includes(contentType)) {
      throw new BadRequestException(
        `File type "${contentType}" is not allowed for proof uploads. Accepted: ${S3Service.PROOF_ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiresIn ?? this.defaultPresignedUrlExpiry });
  }

  /**
   * Returns a presigned PUT URL restricted to PDF/DOCX MIME types and 10 MB max.
   * Used for JD/engagement attachment uploads.
   */
  async getPresignedAttachmentUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string> {
    if (!S3Service.ATTACHMENT_ALLOWED_MIME_TYPES.includes(contentType)) {
      throw new BadRequestException(
        `File type "${contentType}" is not allowed for attachments. Accepted: ${S3Service.ATTACHMENT_ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiresIn ?? this.defaultPresignedUrlExpiry });
  }

  /**
   * Verifies an already-uploaded object has an allowed Content-Type and is within size limits.
   * Deletes the object and throws BadRequestException if either check fails.
   */
  async verifyUpload(
    key: string,
    allowedTypes: string[],
    maxBytes = S3Service.MAX_UPLOAD_BYTES,
  ): Promise<{ contentType: string; size: number }> {
    const command = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
    let head: any;
    try {
      head = await this.s3.send(command);
    } catch {
      throw new BadRequestException(`Uploaded file not found at key: ${key}`);
    }

    const contentType: string = head.ContentType ?? '';
    const size: number = head.ContentLength ?? 0;

    if (!allowedTypes.includes(contentType)) {
      await this.deleteObject(key).catch(() => {});
      throw new BadRequestException(
        `Uploaded file has disallowed Content-Type "${contentType}". Accepted: ${allowedTypes.join(', ')}`,
      );
    }

    if (size > maxBytes) {
      await this.deleteObject(key).catch(() => {});
      throw new BadRequestException(
        `Uploaded file is ${size} bytes, exceeding the ${maxBytes}-byte limit`,
      );
    }

    return { contentType, size };
  }

  /**
   * Download an object's full contents into memory.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.s3.send(command);
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Move an object to a new key (copy, then delete the original).
   */
  async moveObject(sourceKey: string, destinationKey: string): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
        Key: destinationKey,
      }),
    );
    await this.deleteObject(sourceKey);
    this.logger.debug(`Moved S3 object: ${sourceKey} -> ${destinationKey}`);
  }

  /**
   * List all objects in the bucket with a given prefix.
   */
  async listObjects(prefix?: string): Promise<{ key: string; lastModified: Date; size: number }[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.s3.send(command);
    
    return (response.Contents || []).map((obj) => ({
      key: obj.Key!,
      lastModified: obj.LastModified!,
      size: obj.Size || 0,
    }));
  }

  /**
   * Delete a single object from S3.
   */
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.s3.send(command);
    this.logger.debug(`Deleted S3 object: ${key}`);
  }

  /**
   * Check if an object exists in S3.
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(command);
      return true;
    } catch (error) {
      if ((error as any).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}
