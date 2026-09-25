import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { EngagementStatus, NotificationType, SecurityEventAction } from "@prisma/client";
import { createHmac, randomBytes } from "crypto";
import * as nodemailer from "nodemailer";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/prisma/prisma.service";
import { S3Service } from "../../common/s3/s3.service";
import { CacheService } from "../../common/cache/cache.service";
import { SecurityEventsService } from "../../common/security-events/security-events.service";
import { StellarService } from "../../common/stellar/stellar.service";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { PublicUserDto } from "./dto/public-user.dto";
import { UserProfileDto } from "./dto/user-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class UsersService {
  private static readonly PROFILE_TTL_S = 60;
  private static readonly EMAIL_TOKEN_TTL_H = 24;

  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly cache: CacheService,
    private readonly securityEvents: SecurityEventsService,
    private readonly config: ConfigService,
    private readonly stellar: StellarService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: false,
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

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
    if (!user) throw new NotFoundException("User not found");

    let averageRating: number | null | undefined;
    if (user.role === "RECRUITER") {
      const avg = await this.prisma.recruiterReview.aggregate({
        where: { recruiterId: user.id },
        _avg: { rating: true },
      });
      averageRating =
        avg._avg.rating != null ? Math.round(avg._avg.rating * 10) / 10 : null;
    }

    const { id: _id, ...profile } = user;
    const result: PublicUserDto = {
      ...profile,
      ...(averageRating !== undefined ? { averageRating } : {}),
    };
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
        timezone: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
        locale: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    // Prevent stellarAddress modification — use POST /users/me/stellar-address instead.
    if (dto.stellarAddress !== undefined) {
      throw new BadRequestException(
        "stellarAddress is immutable and cannot be updated",
      );
    }

    // Block direct email changes — they must go through the verified flow.
    if (dto.email !== undefined) {
      throw new BadRequestException(
        "Email cannot be changed directly. Use POST /users/me/email to start the verified change flow.",
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.company !== undefined && { company: dto.company }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
      },
      select: {
        name: true,
        email: true,
        company: true,
        timezone: true,
        stellarAddress: true,
        avatarUrl: true,
        role: true,
        locale: true,
      },
    });

    return user;
  }

  // ── Issue #356 ────────────────────────────────────────────────────────────

  /**
   * Step 1: Validate the new email, generate an HMAC token, store it against
   * the user and send a confirmation link to the *new* address.
   */
  async requestEmailChange(userId: string, newEmail: string, meta?: { ip?: string; userAgent?: string }) {
    const email = newEmail.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.email?.toLowerCase() === email) {
      throw new BadRequestException('New email must be different from the current email');
    }

    // Check the new address isn't already taken
    const taken = await this.prisma.user.findUnique({ where: { email } });
    if (taken) {
      throw new ConflictException('This email address is already registered');
    }

    const token = this.generateEmailChangeToken(userId);
    const expiresAt = new Date(
      Date.now() + UsersService.EMAIL_TOKEN_TTL_H * 60 * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: email,
        emailChangeToken: token,
        emailChangeTokenExpiresAt: expiresAt,
      },
    });

    await this.sendEmailChangeConfirmation(email, token, user.locale ?? 'en');

    // Notify the *old* address so the user is aware
    if (user.email) {
      await this.sendEmailChangeNotification(user.email, email, user.locale ?? 'en');
    }

    return { message: 'A confirmation link has been sent to your new email address. It expires in 24 hours.' };
  }

  /**
   * Step 2: Validate the token, swap the email, clear pending fields, log
   * a security event.
   */
  async confirmEmailChange(token: string) {
    const user = await this.prisma.user.findUnique({
      where: { emailChangeToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired email confirmation token');
    }

    if (!user.emailChangeTokenExpiresAt || user.emailChangeTokenExpiresAt < new Date()) {
      throw new BadRequestException('Email confirmation token has expired. Please request a new one.');
    }

    if (!user.pendingEmail) {
      throw new BadRequestException('No pending email change found');
    }

    const newEmail = user.pendingEmail;

    // Double-check the address hasn't been registered since the token was issued
    const taken = await this.prisma.user.findFirst({
      where: { email: newEmail, id: { not: user.id } },
    });
    if (taken) {
      // Wipe the pending state so a fresh request must be made
      await this.prisma.user.update({
        where: { id: user.id },
        data: { pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null },
      });
      throw new ConflictException(
        'The email address is no longer available. Please request a new email change.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: newEmail,
        pendingEmail: null,
        emailChangeToken: null,
        emailChangeTokenExpiresAt: null,
      },
    });

    await this.securityEvents.log({
      userId: user.id,
      action: SecurityEventAction.EMAIL_VERIFICATION,
    });

    return { message: 'Email address updated successfully.', email: newEmail };
  }

  // ── Private email helpers ─────────────────────────────────────────────────

  private generateEmailChangeToken(userId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? 'fallback-secret';
    const nonce = randomBytes(24).toString('hex');
    const hmac = createHmac('sha256', secret)
      .update(`${userId}:${nonce}`)
      .digest('hex');
    return `${nonce}.${hmac}`;
  }

  private async sendEmailChangeConfirmation(to: string, token: string, locale: string) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    // API-level confirm link — clients can redirect from here
    const confirmUrl = `${frontendUrl}/settings/email/confirm?token=${encodeURIComponent(token)}`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Confirm your new email – HireSettle</title></head>
<body style="font-family:sans-serif;background:#f4f4f4;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;padding:20px;border-radius:8px;">
    <div style="background:#007bff;color:#fff;padding:10px 20px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="margin:0;">HireSettle</h1>
    </div>
    <div style="padding:20px;">
      <h2>Confirm your new email address</h2>
      <p>You requested to change your HireSettle email to this address. Click the button below to confirm.</p>
      <p style="text-align:center;">
        <a href="${confirmUrl}"
           style="display:inline-block;padding:12px 24px;background:#007bff;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">
          Confirm new email
        </a>
      </p>
      <p style="color:#666;font-size:0.85em;">This link expires in 24 hours. If you did not request this change, you can ignore this email.</p>
      <p style="color:#666;font-size:0.85em;">Or copy this link: <a href="${confirmUrl}">${confirmUrl}</a></p>
    </div>
  </div>
</body>
</html>`;

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', 'noreply@hiresettle.com'),
      to,
      subject: '✉️ Confirm your new email – HireSettle',
      html,
    });
  }

  private async sendEmailChangeNotification(oldEmail: string, newEmail: string, locale: string) {
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Email change notice – HireSettle</title></head>
<body style="font-family:sans-serif;background:#f4f4f4;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;padding:20px;border-radius:8px;">
    <div style="background:#007bff;color:#fff;padding:10px 20px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="margin:0;">HireSettle</h1>
    </div>
    <div style="padding:20px;">
      <h2>Your email address is being changed</h2>
      <p>A request was made to change the email address on your HireSettle account to <strong>${newEmail}</strong>.</p>
      <p>If you did not request this, please contact support immediately at <a href="mailto:support@hiresettle.com">support@hiresettle.com</a>.</p>
    </div>
  </div>
</body>
</html>`;

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', 'noreply@hiresettle.com'),
      to: oldEmail,
      subject: '⚠️ Email change requested – HireSettle',
      html,
    });
  }

  // ── Issue #357 ────────────────────────────────────────────────────────────

  /**
   * Bind a new Stellar address to the authenticated user.
   *
   * Security requirements:
   *  - The `nonce` must have been issued via GET /auth/rebind-challenge (10-min TTL, consumed here).
   *  - `newSignature` must be a valid Ed25519 signature of the nonce by the *new* keypair.
   *  - If the user already has a Stellar address, `oldSignature` must also be a valid signature
   *    of the nonce by the *old* keypair (proves the user still controls the old key).
   *  - The user must have no active funded engagements referencing their current address.
   */
  async rebindStellarAddress(
    userId: string,
    newAddress: string,
    nonce: string,
    newSignature: string,
    oldSignature: string | undefined,
    meta?: { ip?: string; userAgent?: string },
  ) {
    // 1. Validate new address format
    if (!this.stellar.isValidStellarAddress(newAddress)) {
      throw new BadRequestException('Invalid Stellar address format');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // 2. Reject if new address is the same as the current one
    if (user.stellarAddress === newAddress) {
      throw new BadRequestException('New Stellar address must be different from the current one');
    }

    // 3. Verify new address signature
    const newSigValid = this.stellar.verifySignature(newAddress, nonce, newSignature);
    if (!newSigValid) {
      throw new BadRequestException(
        'Invalid signature from new Stellar address. Sign the nonce with your new keypair.',
      );
    }

    // 4. If user has an existing address, require old key signature
    if (user.stellarAddress) {
      if (!oldSignature) {
        throw new BadRequestException(
          'oldSignature is required when the account already has a linked Stellar address.',
        );
      }
      const oldSigValid = this.stellar.verifySignature(user.stellarAddress, nonce, oldSignature);
      if (!oldSigValid) {
        throw new BadRequestException(
          'Invalid signature from old Stellar address. Sign the nonce with your current keypair.',
        );
      }
    }

    // 5. Block if user has active or pending-acceptance funded engagements
    const activeStatuses = [
      EngagementStatus.ACTIVE,
      EngagementStatus.PENDING_ACCEPTANCE,
      EngagementStatus.REPLACEMENT_REQUESTED,
    ];

    if (user.stellarAddress) {
      const activeCount = await this.prisma.engagement.count({
        where: {
          status: { in: activeStatuses },
          OR: [
            { companyAddress: user.stellarAddress },
            { recruiterAddress: user.stellarAddress },
            { arbiterAddress: user.stellarAddress },
          ],
        },
      });

      if (activeCount > 0) {
        throw new ForbiddenException(
          'Cannot rebind Stellar address while you have active funded engagements. ' +
            'Complete or cancel all active engagements first.',
        );
      }
    }

    // 6. Ensure new address isn't already claimed by another user
    const taken = await this.prisma.user.findFirst({
      where: { stellarAddress: newAddress, id: { not: userId } },
    });
    if (taken) {
      throw new ConflictException('This Stellar address is already linked to another account');
    }

    // 7. Persist the new address
    await this.prisma.user.update({
      where: { id: userId },
      data: { stellarAddress: newAddress },
    });

    // 8. Record security event
    await this.securityEvents.log({
      userId,
      action: SecurityEventAction.ROLE_CHANGE, // closest existing action for key-material change
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });

    return {
      message: 'Stellar address updated successfully.',
      stellarAddress: newAddress,
    };
  }

  async getAvatarUploadUrl(
    userId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    const ext = contentType === "image/png" ? "png" : "jpg";
    const key = `avatars/${userId}/${Date.now()}.${ext}`;
    const uploadUrl = await this.s3Service.getPresignedUploadUrl(
      key,
      contentType,
    );
    // Store the key on the user record so the CDN URL is available after upload
    const cdnBase = process.env.S3_CDN_URL || process.env.S3_ENDPOINT;
    const avatarUrl = `${cdnBase}/${key}`;
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    // Note: old avatar key is not deleted here — cleanup of orphaned objects should
    // be handled by a scheduled S3 lifecycle rule or the s3-cleanup service.
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
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
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        "Invalid file type. Only JPEG and PNG are allowed.",
      );
    }

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException("File size exceeds 2 MB limit.");
    }

    const fileExtension = file.mimetype === "image/png" ? "png" : "jpg";
    const key = `avatars/${userId}/${Date.now()}.${fileExtension}`;

    await this.s3Service.uploadFile(key, file.buffer, file.mimetype);

    const cdnUrl = `${process.env.S3_CDN_URL || process.env.S3_ENDPOINT}/${key}`;

    return this.updateAvatar(userId, cdnUrl);
  }

  async getCustomFieldsConfig(
    userId: string,
  ): Promise<{ allowedCustomFields: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { allowedCustomFields: true },
    });
    if (!user) throw new NotFoundException("User not found");
    return { allowedCustomFields: user.allowedCustomFields };
  }

  async updateCustomFieldsConfig(
    userId: string,
    allowedCustomFields: string[],
  ): Promise<{ allowedCustomFields: string[] }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { allowedCustomFields },
      select: { allowedCustomFields: true },
    });
    return { allowedCustomFields: user.allowedCustomFields };
  }

  async setSlackWebhook(userId: string, url: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { slackWebhookUrl: url },
    });
    return { slackWebhookUrl: url };
  }

  async clearSlackWebhook(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { slackWebhookUrl: null },
    });
    return { slackWebhookUrl: null };
  }

  async setDiscordWebhook(userId: string, url: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { discordWebhookUrl: url },
    });
    return { discordWebhookUrl: url };
  }

  async clearDiscordWebhook(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { discordWebhookUrl: null },
    });
    return { discordWebhookUrl: null };
  }
}
