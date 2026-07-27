import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
