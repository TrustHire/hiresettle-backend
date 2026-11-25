import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiKeyScope } from '../../../common/decorators/api-key-scopes.decorator';

export class CreateOAuthClientDto {
  @ApiProperty({ example: 'Workday sync' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @ApiProperty({ enum: ApiKeyScope, isArray: true, example: ['engagements:read'] })
  @IsArray() @ArrayUnique() @IsEnum(ApiKeyScope, { each: true })
  scopes: ApiKeyScope[];
}

export class UpdateOAuthClientDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ApiKeyScope, isArray: true })
  @IsOptional() @IsArray() @ArrayUnique() @IsEnum(ApiKeyScope, { each: true })
  scopes?: ApiKeyScope[];
}

/** RFC 6749 §4.4 token request. Credentials may also arrive via HTTP Basic auth. */
export class OAuthTokenRequestDto {
  @ApiProperty({ example: 'client_credentials' })
  @IsIn(['client_credentials'])
  grant_type: 'client_credentials';

  @ApiPropertyOptional() @IsOptional() @IsString()
  client_id?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  client_secret?: string;

  @ApiPropertyOptional({ description: 'Space-delimited subset of the scopes granted to the client' })
  @IsOptional() @IsString()
  scope?: string;
}
