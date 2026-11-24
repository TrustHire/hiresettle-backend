import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgencyRole, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { InviteAgencyMemberDto } from './dto/invite-agency-member.dto';

const INVITE_TTL_DAYS = 7;

@Injectable()
export class AgenciesService {
  private readonly logger = new Logger(AgenciesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAgency(userId: string, dto: CreateAgencyDto) {
    const existingMembership = await this.prisma.agencyMember.findUnique({
      where: { userId },
    });
    if (existingMembership) {
      throw new ConflictException('You already belong to an agency');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const agency = await tx.agency.create({
          data: {
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            description: dto.description?.trim() ?? null,
            website: dto.website?.trim() ?? null,
          },
        });

        await tx.agencyMember.create({
          data: {
            agencyId: agency.id,
            userId,
            role: AgencyRole.OWNER,
          },
        });

        return agency;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Agency slug "${dto.slug}" is already taken`);
      }
      throw error;
    }
  }

  async inviteMember(ownerId: string, agencyId: string, dto: InviteAgencyMemberDto) {
    await this.requireOwner(ownerId, agencyId);

    const email = dto.email.toLowerCase();
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.agencyInvite.create({
      data: {
        agencyId,
        email,
        role: dto.role ?? AgencyRole.RECRUITER,
        token,
        expiresAt,
      },
    });

    this.logger.log(`Agency invite created: agency=${agencyId} email=${email}`);
    return {
      id: invite.id,
      agencyId: invite.agencyId,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(userId: string, token: string) {
    const existingMembership = await this.prisma.agencyMember.findUnique({
      where: { userId },
    });
    if (existingMembership) {
      throw new ConflictException('A recruiter can belong to only one agency at a time');
    }

    const invite = await this.prisma.agencyInvite.findUnique({ where: { token } });
    if (!invite) {
      throw new NotFoundException('Agency invite not found');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Agency invite has already been accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Agency invite has expired');
    }

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.agencyMember.create({
        data: {
          agencyId: invite.agencyId,
          userId,
          role: invite.role,
        },
        include: {
          agency: { select: { id: true, name: true, slug: true } },
        },
      });

      await tx.agencyInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      return member;
    });
  }

  async listMembers(userId: string, agencyId: string) {
    await this.requireMember(userId, agencyId);

    return this.prisma.agencyMember.findMany({
      where: { agencyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            stellarAddress: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeMember(ownerId: string, agencyId: string, targetUserId: string) {
    await this.requireOwner(ownerId, agencyId);

    const target = await this.prisma.agencyMember.findUnique({
      where: { userId: targetUserId },
    });
    if (!target || target.agencyId !== agencyId) {
      throw new NotFoundException('Member not found in this agency');
    }

    if (target.role === AgencyRole.OWNER) {
      const ownerCount = await this.prisma.agencyMember.count({
        where: { agencyId, role: AgencyRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot remove the sole owner of the agency');
      }
    }

    await this.prisma.agencyMember.delete({ where: { id: target.id } });
    return { removed: true, userId: targetUserId };
  }

  /**
   * Read-only view of all member engagements for an agency owner.
   * Agency owners can read but not act on a member's engagements.
   */
  async getMemberEngagements(ownerId: string, agencyId: string) {
    await this.requireOwner(ownerId, agencyId);

    const members = await this.prisma.agencyMember.findMany({
      where: { agencyId },
      include: {
        user: { select: { id: true, name: true, stellarAddress: true } },
      },
    });

    const addresses = members
      .map((m) => m.user.stellarAddress)
      .filter((addr): addr is string => Boolean(addr));

    if (addresses.length === 0) {
      return { readOnly: true, engagements: [] };
    }

    const engagements = await this.prisma.engagement.findMany({
      where: {
        recruiterAddress: { in: addresses },
        archivedAt: null,
      },
      include: {
        milestones: { orderBy: { milestoneIndex: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      readOnly: true,
      engagements: engagements.map((e) => ({
        ...e,
        totalAmount: e.totalAmount.toString(),
        releasedAmount: e.releasedAmount.toString(),
        milestones: e.milestones.map((m) => ({
          ...m,
          paymentReleased: m.paymentReleased?.toString() ?? null,
        })),
      })),
    };
  }

  /**
   * Aggregates member engagements and payouts across the agency.
   */
  async getDashboard(userId: string, agencyId: string) {
    await this.requireMember(userId, agencyId);

    const agency = await this.prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency) {
      throw new NotFoundException(`Agency ${agencyId} not found`);
    }

    const members = await this.prisma.agencyMember.findMany({
      where: { agencyId },
      include: {
        user: { select: { id: true, name: true, stellarAddress: true } },
      },
    });

    const addresses = members
      .map((m) => m.user.stellarAddress)
      .filter((addr): addr is string => Boolean(addr));

    const engagements =
      addresses.length > 0
        ? await this.prisma.engagement.findMany({
            where: { recruiterAddress: { in: addresses }, archivedAt: null },
            select: {
              id: true,
              recruiterAddress: true,
              status: true,
              totalAmount: true,
              releasedAmount: true,
            },
          })
        : [];

    let totalEscrowed = 0n;
    let totalPayouts = 0n;
    const byRecruiter = new Map<
      string,
      { engagements: number; escrowed: bigint; payouts: bigint }
    >();

    for (const eng of engagements) {
      totalEscrowed += eng.totalAmount;
      totalPayouts += eng.releasedAmount;
      const entry = byRecruiter.get(eng.recruiterAddress) ?? {
        engagements: 0,
        escrowed: 0n,
        payouts: 0n,
      };
      entry.engagements += 1;
      entry.escrowed += eng.totalAmount;
      entry.payouts += eng.releasedAmount;
      byRecruiter.set(eng.recruiterAddress, entry);
    }

    return {
      agency: { id: agency.id, name: agency.name, slug: agency.slug },
      memberCount: members.length,
      totalEngagements: engagements.length,
      totalEscrowed: totalEscrowed.toString(),
      totalPayouts: totalPayouts.toString(),
      members: members.map((m) => {
        const stats = m.user.stellarAddress
          ? byRecruiter.get(m.user.stellarAddress)
          : undefined;
        return {
          userId: m.user.id,
          name: m.user.name,
          role: m.role,
          stellarAddress: m.user.stellarAddress,
          engagements: stats?.engagements ?? 0,
          escrowed: (stats?.escrowed ?? 0n).toString(),
          payouts: (stats?.payouts ?? 0n).toString(),
        };
      }),
    };
  }

  private async requireMember(userId: string, agencyId: string) {
    const member = await this.prisma.agencyMember.findUnique({ where: { userId } });
    if (!member || member.agencyId !== agencyId) {
      throw new ForbiddenException('You are not a member of this agency');
    }
    return member;
  }

  private async requireOwner(userId: string, agencyId: string) {
    const member = await this.requireMember(userId, agencyId);
    if (member.role !== AgencyRole.OWNER) {
      throw new ForbiddenException('Only agency owners can perform this action');
    }
    return member;
  }
}
