import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsArray, IsString, ArrayMaxSize } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RateLimit } from "../../common/decorators/throttle.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserJwtSubThrottlerGuard } from "../../common/guards/user-jwt-sub-throttler.guard";
import { PublicUserDto } from "./dto/public-user.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UserProfileDto } from "./dto/user-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { SetSlackWebhookDto } from "./dto/set-slack-webhook.dto";
import { SetDiscordWebhookDto } from "./dto/set-discord-webhook.dto";
import { AvatarUploadDto } from "./dto/avatar-upload.dto";
import { UserDataExportDto } from "./dto/user-data-export.dto";
import { UsersService } from "./users.service";
import { GdprService } from "./gdpr.service";
import { UserRole } from "@prisma/client";

class UpdateCustomFieldsConfigDto {
  @ApiProperty({
    type: [String],
    example: ["internalReqId", "department"],
    maxItems: 50,
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  allowedCustomFields: string[];
}

// Stellar public key: G + 55 base32 uppercase chars = 56 chars total
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly gdprService: GdprService,
  ) {}

  @Get("me/export")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, UserJwtSubThrottlerGuard)
  @RateLimit(5, 60)
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @ApiOperation({
    summary:
      "GDPR right-to-access: download a JSON export of the current user's data",
  })
  @ApiResponse({
    status: 200,
    description: "User data export bundle",
    type: UserDataExportDto,
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 429, description: "Too many requests" })
  exportMe(@CurrentUser("id") userId: string): Promise<UserDataExportDto> {
    return this.gdprService.exportUserData(userId);
  }

  @Delete("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "GDPR right-to-erasure: close account after re-authentication",
  })
  @ApiResponse({
    status: 200,
    description: "Account closed, PII anonymised, deletion request queued",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized or re-authentication failed",
  })
  @ApiResponse({
    status: 409,
    description: "Active engagements block deletion",
  })
  deleteMe(@CurrentUser("id") userId: string, @Body() dto: DeleteAccountDto) {
    return this.gdprService.requestErasure(userId, dto);
  }

  @Get("me/notification-preferences")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get notification preferences for current user" })
  @ApiResponse({ status: 200, description: "Preferences retrieved" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getPreferences(@CurrentUser("id") userId: string) {
    return this.usersService.getPreferences(userId);
  }

  @Put("me/notification-preferences")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Update notification preferences (bulk)" })
  @ApiResponse({ status: 200, description: "Preferences updated" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 422, description: "Validation failed" })
  updatePreferences(
    @CurrentUser("id") userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(userId, dto);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get authenticated user profile" })
  @ApiResponse({
    status: 200,
    description: "User profile retrieved",
    type: UserProfileDto,
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getProfile(@CurrentUser("id") userId: string): Promise<UserProfileDto> {
    return this.usersService.getProfile(userId);
  }

  @Patch("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Update authenticated user profile (name, company, email)",
  })
  @ApiResponse({
    status: 200,
    description: "Profile updated",
    type: UserProfileDto,
  })
  @ApiResponse({ status: 400, description: "stellarAddress is immutable" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 422, description: "Validation failed" })
  updateProfile(
    @CurrentUser("id") userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    return this.usersService.updateProfile(userId, dto);
  }

  @Put("me/slack-webhook")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Set the Slack incoming-webhook URL for notification alerts",
  })
  @ApiResponse({ status: 200, description: "Slack webhook configured" })
  @ApiResponse({ status: 400, description: "Invalid URL" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  setSlackWebhook(
    @CurrentUser("id") userId: string,
    @Body() dto: SetSlackWebhookDto,
  ) {
    return this.usersService.setSlackWebhook(userId, dto.url);
  }

  @Delete("me/slack-webhook")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Clear the Slack incoming-webhook URL (disable Slack alerts)",
  })
  @ApiResponse({ status: 200, description: "Slack webhook cleared" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  clearSlackWebhook(@CurrentUser("id") userId: string) {
    return this.usersService.clearSlackWebhook(userId);
  }

  @Put("me/discord-webhook")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Set the Discord incoming-webhook URL for notification alerts (#278)",
  })
  @ApiResponse({ status: 200, description: "Discord webhook configured" })
  @ApiResponse({ status: 400, description: "Invalid URL" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  setDiscordWebhook(
    @CurrentUser("id") userId: string,
    @Body() dto: SetDiscordWebhookDto,
  ) {
    return this.usersService.setDiscordWebhook(userId, dto.url!);
  }

  @Delete("me/discord-webhook")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Clear the Discord incoming-webhook URL (disable Discord alerts) (#278)",
  })
  @ApiResponse({ status: 200, description: "Discord webhook cleared" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  clearDiscordWebhook(@CurrentUser("id") userId: string) {
    return this.usersService.clearDiscordWebhook(userId);
  }

  @Post("me/avatar/presigned-url")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Get a presigned S3 URL to upload the current user avatar directly",
  })
  @ApiResponse({
    status: 201,
    description: "Presigned upload URL returned",
    schema: {
      properties: { uploadUrl: { type: "string" }, key: { type: "string" } },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid MIME type" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getAvatarUploadUrl(
    @CurrentUser("id") userId: string,
    @Body() dto: AvatarUploadDto,
  ) {
    return this.usersService.getAvatarUploadUrl(userId, dto.contentType);
  }

  @Post("me/avatar")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("avatar"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload user avatar (JPEG/PNG ≤ 2 MB)" })
  @ApiResponse({
    status: 200,
    description: "Avatar uploaded",
    type: UserProfileDto,
  })
  @ApiResponse({ status: 400, description: "Invalid file type or size" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async uploadAvatar(
    @CurrentUser("id") userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UserProfileDto> {
    if (!file) {
      throw new BadRequestException("No file provided");
    }
    return this.usersService.uploadAvatar(userId, file);
  }

  @Get("me/custom-fields-config")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({
    summary:
      "Get allowed custom field keys for engagement creation (COMPANY only)",
  })
  @ApiResponse({ status: 200, description: "Allowed custom fields list" })
  getCustomFieldsConfig(@CurrentUser("id") userId: string) {
    return this.usersService.getCustomFieldsConfig(userId);
  }

  @Put("me/custom-fields-config")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({
    summary:
      "Set allowed custom field keys for engagement creation (COMPANY only, max 50 keys)",
  })
  @ApiBody({ type: UpdateCustomFieldsConfigDto })
  @ApiResponse({ status: 200, description: "Allowed custom fields updated" })
  updateCustomFieldsConfig(
    @CurrentUser("id") userId: string,
    @Body() dto: UpdateCustomFieldsConfigDto,
  ) {
    return this.usersService.updateCustomFieldsConfig(
      userId,
      dto.allowedCustomFields,
    );
  }

  @Get(":stellarAddress")
  @ApiOperation({
    summary: "Look up public profile by Stellar address (no auth required)",
  })
  @ApiParam({
    name: "stellarAddress",
    example: "GABC...XYZ",
    description: "Stellar public key (56 chars, starts with G)",
  })
  @ApiResponse({ status: 200, description: "Public profile retrieved" })
  @ApiResponse({ status: 400, description: "Invalid Stellar address format" })
  @ApiResponse({ status: 404, description: "User not found" })
  getPublicProfile(
    @Param("stellarAddress") stellarAddress: string,
  ): Promise<PublicUserDto> {
    if (!STELLAR_ADDRESS_RE.test(stellarAddress)) {
      throw new BadRequestException("Invalid Stellar address format");
    }
    return this.usersService.findByStellarAddress(stellarAddress);
  }
}
