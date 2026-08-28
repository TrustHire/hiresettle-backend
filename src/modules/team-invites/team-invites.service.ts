import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordPolicyService } from '../../common/password/password-policy.service';
import { SendInviteDto } from './dto/send-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { scrypt as scryptCallback } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const INVITE_TTL_DAYS = 7;

@Injectable()
export class TeamInvitesService {
  private readonly logger = new Logger(TeamInvitesService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly passwordPolicy: PasswordPolicyService,
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

  /**
   * Send a team invite from a COMPANY user to an email address.
   * Generates a signed token and emails an acceptance link.
   */
  async sendInvite(companyOwnerId: string, dto: SendInviteDto) {
    const owner = await this.prisma.user.findUnique({ where: { id: companyOwnerId } });
    if (!owner || owner.role !== UserRole.COMPANY) {
      throw new ForbiddenException('Only COMPANY users can send team invites');
    }

    const email = dto.email.toLowerCase();

    // Reject if the email is already registered
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email is already registered');
    }

    // Revoke any pending invite for the same owner + email pair
    await this.prisma.teamInvite.deleteMany({
      where: { companyOwnerId, email, acceptedAt: null },
    });

    const token = this.generateToken(companyOwnerId);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.teamInvite.create({
      data: { companyOwnerId, email, token, expiresAt },
    });

    await this.sendInviteEmail(email, token, owner.company ?? owner.name ?? 'your team');

    this.logger.log(`Team invite sent: owner=${companyOwnerId} email=${email}`);
    return { id: invite.id, email: invite.email, expiresAt: invite.expiresAt };
  }

  /**
   * Accept a team invite.
   * Creates a new User linked to the inviting company owner.
   * Issues a JWT pair via the return value.
   */
  async acceptInvite(token: string, dto: AcceptInviteDto) {
    const invite = await this.prisma.teamInvite.findUnique({ where: { token } });

    if (!invite) {
      throw new NotFoundException('Invite not found or already used');
    }

    if (invite.acceptedAt) {
      throw new BadRequestException('This invite has already been accepted');
    }

    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite has expired');
    }

    this.passwordPolicy.validate(dto.password);

    const email = invite.email;

    // Guard against a race where someone registered the email between invite creation and acceptance
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('A user with this email is already registered');
    }

    const owner = await this.prisma.user.findUnique({ where: { id: invite.companyOwnerId } });

    const passwordHash = await this.hashPassword(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: dto.name,
            company: owner?.company ?? null,
            role: UserRole.COMPANY,
            companyOwnerId: invite.companyOwnerId,
          },
        });

        await tx.teamInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });

        return newUser;
      });

      this.logger.log(`Team invite accepted: userId=${user.id} owner=${invite.companyOwnerId}`);
      return {
        message: 'Invite accepted. Your account has been created.',
        userId: user.id,
        email: user.email,
        companyOwnerId: user.companyOwnerId,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  /**
   * List pending (not yet accepted, not expired) invites sent by a company owner.
   */
  async listInvites(companyOwnerId: string) {
    return this.prisma.teamInvite.findMany({
      where: {
        companyOwnerId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke a pending invite. Only the company owner who sent it can revoke.
   */
  async revokeInvite(companyOwnerId: string, inviteId: string) {
    const invite = await this.prisma.teamInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.companyOwnerId !== companyOwnerId) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Cannot revoke an already-accepted invite');
    }
    await this.prisma.teamInvite.delete({ where: { id: inviteId } });
    return { revoked: true };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private generateToken(companyOwnerId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? 'fallback-secret';
    const nonce = randomBytes(24).toString('hex');
    const hmac = createHmac('sha256', secret)
      .update(`${companyOwnerId}:${nonce}`)
      .digest('hex');
    // Embed the nonce so the token is self-contained and unique
    return `${nonce}.${hmac}`;
  }

  private async sendInviteEmail(to: string, token: string, companyName: string) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const acceptUrl = `${frontendUrl}/invites/accept?token=${token}`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>You've been invited to join HireSettle</title>
</head>
<body style="font-family:sans-serif;background:#f4f4f4;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;padding:20px;border-radius:8px;">
    <div style="background:#007bff;color:#fff;padding:10px 20px;border-radius:8px 8px 0 0;text-align:center;">
      <h1>HireSettle</h1>
    </div>
    <div style="padding:20px;color:#333;line-height:1.6;">
      <p>You've been invited to join <strong>${companyName}</strong> on HireSettle.</p>
      <p>Click the button below to accept the invitation and create your account. The link is valid for ${INVITE_TTL_DAYS} days.</p>
      <p>
        <a href="${acceptUrl}"
           style="display:inline-block;background:#007bff;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">
          Accept Invitation
        </a>
      </p>
      <p>Or copy this link into your browser:<br><small>${acceptUrl}</small></p>
      <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
    </div>
    <div style="text-align:center;padding:20px;font-size:12px;color:#777;">
      <p>&copy; ${new Date().getFullYear()} HireSettle. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    try {
      await this.transporter.sendMail({
        from: this.config.get('EMAIL_FROM') ?? 'noreply@hiresettle.com',
        to,
        subject: `✉️ You've been invited to join ${companyName} on HireSettle`,
        html,
      });
      this.logger.log(`Invite email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send invite email to ${to}`, error.message);
      // Don't throw — the invite record is created; the sender can resend manually
    }
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return `scrypt:${salt}:${derivedKey.toString('hex')}`;
  }
}
