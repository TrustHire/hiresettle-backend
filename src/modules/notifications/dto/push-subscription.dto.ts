import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PushSubscriptionKeysDto {
  @ApiProperty({ description: 'Client public key (base64url), from PushSubscription.toJSON().keys.p256dh' })
  @IsString() @IsNotEmpty() @MaxLength(256)
  p256dh: string;

  @ApiProperty({ description: 'Auth secret (base64url), from PushSubscription.toJSON().keys.auth' })
  @IsString() @IsNotEmpty() @MaxLength(128)
  auth: string;
}

export class CreatePushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/abc123' })
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'endpoint must be a valid https URL' })
  @MaxLength(2048)
  endpoint: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;

  @ApiProperty({ required: false, example: 'Mozilla/5.0 (Macintosh; ...)' })
  @IsOptional() @IsString() @MaxLength(512)
  userAgent?: string;
}

export class DeletePushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/abc123' })
  @IsString() @IsNotEmpty() @MaxLength(2048)
  endpoint: string;
}
