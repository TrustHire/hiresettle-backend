import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AtsProvider, MilestoneKind, MilestoneStatus, NotificationType, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../../common/crypto/secret-box';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeAtsEvent, verifyAtsSignature } from './ats-providers';
import { CreateAtsIntegrationDto, CreateAtsMappingDto } from './dto/ats.dto';

type HireOutcome = 'ignored' | 'unmapped' | 'no_placement_milestone' | 'already_ready' | 'milestone_ready';

@Injectable()
export class AtsService {
  private readonly logger = new Logger(AtsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // ---------------- Integrations ----------------

  async createIntegration(companyId: string, dto: CreateAtsIntegrationDto) {
    const secret = this.resolveSecret(dto.provider, dto.secret);
    try {
      const integration = await this.prisma.atsIntegration.create({
        data: { companyId, provider: dto.provider, secretEnc: encryptSecret(secret) },
      });
      return { ...this.serialize(integration), secret };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A ${dto.provider} integration already exists for this company`);
      }
      throw err;
    }
  }

  async listIntegrations(companyId: string) {
    const rows = await this.prisma.atsIntegration.findMany({
      where: { companyId },
      include: { _count: { select: { mappings: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ ...this.serialize(r), mappingCount: r._count.mappings }));
  }

  async rotateSecret(companyId: string, id: string, newSecret?: string) {
    const integration = await this.ownedIntegration(companyId, id);
    const secret = this.resolveSecret(integration.provider, newSecret);
    const updated = await this.prisma.atsIntegration.update({
      where: { id },
      data: { secretEnc: encryptSecret(secret) },
    });
    return { ...this.serialize(updated), secret };
  }

  async setEnabled(companyId: string, id: string, enabled: boolean) {
    await this.ownedIntegration(companyId, id);
    const updated = await this.prisma.atsIntegration.update({
      where: { id },
      data: { disabledAt: enabled ? null : new Date() },
    });
    return this.serialize(updated);
  }

  async deleteIntegration(companyId: string, id: string) {
    await this.ownedIntegration(companyId, id);
    await this.prisma.atsIntegration.delete({ where: { id } });
    return { deleted: true, id };
  }

  async listEvents(companyId: string, id: string, limit = 50) {
    await this.ownedIntegration(companyId, id);
    return this.prisma.atsWebhookEvent.findMany({
      where: { integrationId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  // ---------------- Job / candidate → engagement mappings ----------------

  async createMapping(company: { id: string; stellarAddress?: string }, integrationId: string, dto: CreateAtsMappingDto) {
    await this.ownedIntegration(company.id, integrationId);
    if (!dto.externalJobId && !dto.externalCandidateId) {
      throw new BadRequestException('Provide externalJobId, externalCandidateId, or both');
    }

    const engagement = await this.prisma.engagement.findUnique({
      where: { id: dto.engagementId },
      select: { id: true, companyId: true, companyAddress: true },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${dto.engagementId} not found`);
    if (!this.ownsEngagement(company, engagement)) {
      throw new ForbiddenException('Engagement does not belong to this company');
    }

    try {
      return await this.prisma.atsEngagementMapping.create({
        data: {
          integrationId,
          engagementId: engagement.id,
          externalJobId: dto.externalJobId ?? '',
          externalCandidateId: dto.externalCandidateId ?? '',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('That job/candidate combination is already mapped');
      }
      throw err;
    }
  }

  async listMappings(companyId: string, integrationId: string) {
    await this.ownedIntegration(companyId, integrationId);
    return this.prisma.atsEngagementMapping.findMany({ where: { integrationId }, orderBy: { createdAt: 'desc' } });
  }

  async deleteMapping(companyId: string, integrationId: string, mappingId: string) {
    await this.ownedIntegration(companyId, integrationId);
    const { count } = await this.prisma.atsEngagementMapping.deleteMany({ where: { id: mappingId, integrationId } });
    if (!count) throw new NotFoundException(`Mapping ${mappingId} not found`);
    return { deleted: true, id: mappingId };
  }

  // ---------------- Inbound webhook ----------------

  async handleWebhook(
    integrationId: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<{ received: true; outcome: HireOutcome | 'duplicate' }> {
    const integration = await this.prisma.atsIntegration.findUnique({ where: { id: integrationId } });
    if (!integration || integration.disabledAt) throw new NotFoundException('Unknown webhook endpoint');
    if (!rawBody) throw new BadRequestException('Missing request body');

    if (!verifyAtsSignature(integration.provider, decryptSecret(integration.secretEnc), rawBody, headers, body)) {
      this.logger.warn(`Rejected ${integration.provider} webhook with invalid signature for integration ${integrationId}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = normalizeAtsEvent(integration.provider, body);

    // Provider retries resend the identical body — record each body once.
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    let record;
    try {
      record = await this.prisma.atsWebhookEvent.create({
        data: { integrationId, payloadHash, eventType: event.eventType, outcome: 'processing' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true, outcome: 'duplicate' };
      }
      throw err;
    }

    try {
      const { outcome, engagementId } = event.isHire
        ? await this.applyHire(integration.id, integration.companyId, event.externalJobId, event.externalCandidateId)
        : { outcome: 'ignored' as const, engagementId: undefined };

      await this.prisma.atsWebhookEvent.update({ where: { id: record.id }, data: { outcome, engagementId } });
      return { received: true, outcome };
    } catch (err) {
      // Let the provider retry: drop the dedupe record so the retry is processed.
      await this.prisma.atsWebhookEvent.delete({ where: { id: record.id } }).catch(() => undefined);
      throw err;
    }
  }

  private async applyHire(
    integrationId: string,
    companyId: string,
    jobId: string | undefined,
    candidateId: string | undefined,
  ): Promise<{ outcome: HireOutcome; engagementId?: string }> {
    // Most specific mapping wins: job+candidate, then candidate-only, then job-only.
    const candidates: Array<{ externalJobId: string; externalCandidateId: string }> = [];
    if (jobId && candidateId) candidates.push({ externalJobId: jobId, externalCandidateId: candidateId });
    if (candidateId) candidates.push({ externalJobId: '', externalCandidateId: candidateId });
    if (jobId) candidates.push({ externalJobId: jobId, externalCandidateId: '' });
    if (!candidates.length) return { outcome: 'unmapped' };

    const mappings = await this.prisma.atsEngagementMapping.findMany({ where: { integrationId, OR: candidates } });
    const mapping = candidates
      .map((c) => mappings.find((m) => m.externalJobId === c.externalJobId && m.externalCandidateId === c.externalCandidateId))
      .find(Boolean);
    if (!mapping) return { outcome: 'unmapped' };

    const engagement = await this.prisma.engagement.findUnique({
      where: { id: mapping.engagementId },
      include: {
        milestones: {
          where: { kind: MilestoneKind.PLACEMENT },
          orderBy: { milestoneIndex: 'asc' },
        },
      },
    });
    const company = await this.prisma.user.findUnique({ where: { id: companyId }, select: { id: true, stellarAddress: true } });
    // Re-check ownership: the engagement may have changed hands since the mapping was made.
    if (!engagement || !company || !this.ownsEngagement({ id: company.id, stellarAddress: company.stellarAddress ?? undefined }, engagement)) {
      return { outcome: 'unmapped' };
    }

    const placement = engagement.milestones.find((m) => m.status === MilestoneStatus.PENDING);
    if (!placement) return { outcome: 'no_placement_milestone', engagementId: engagement.id };

    const now = new Date();
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.milestone.updateMany({
        where: { id: placement.id, readyForProofAt: null, status: MilestoneStatus.PENDING },
        data: { readyForProofAt: now },
      }),
      this.prisma.engagement.updateMany({
        where: { id: engagement.id, placedAt: null },
        data: { placedAt: now },
      }),
    ]);
    if (!count) return { outcome: 'already_ready', engagementId: engagement.id };

    const requirements = placement.proofRequirements?.length
      ? ` Required proof: ${placement.proofRequirements.join(', ')}.`
      : '';
    await this.notifications.notifyUser(
      engagement.recruiterAddress,
      NotificationType.ATS_CANDIDATE_HIRED,
      'Candidate hired — submit placement proof',
      `The candidate for "${engagement.jobTitle}" was marked hired in the company's ATS. ` +
        `Milestone "${placement.name}" is ready for proof.${requirements}`,
      { engagementId: engagement.id, milestoneIndex: placement.milestoneIndex, milestoneId: placement.id },
    );

    this.logger.log(`ATS hire marked milestone ${placement.id} ready on engagement ${engagement.id}`);
    return { outcome: 'milestone_ready', engagementId: engagement.id };
  }

  // ---------------- helpers ----------------

  private resolveSecret(provider: AtsProvider, supplied?: string): string {
    if (supplied) return supplied;
    if (provider === AtsProvider.LEVER) {
      throw new BadRequestException('Lever integrations require the signature token from Lever as `secret`');
    }
    return randomBytes(32).toString('hex');
  }

  private async ownedIntegration(companyId: string, id: string) {
    const integration = await this.prisma.atsIntegration.findFirst({ where: { id, companyId } });
    if (!integration) throw new NotFoundException(`ATS integration ${id} not found`);
    return integration;
  }

  private ownsEngagement(
    company: { id: string; stellarAddress?: string },
    engagement: { companyId: string | null; companyAddress: string },
  ) {
    return engagement.companyId === company.id || (!!company.stellarAddress && engagement.companyAddress === company.stellarAddress);
  }

  private serialize(i: { id: string; provider: AtsProvider; disabledAt: Date | null; createdAt: Date; updatedAt: Date }) {
    const base = (this.config.get<string>('PUBLIC_API_URL') ?? '').replace(/\/$/, '');
    const prefix = this.config.get<string>('API_PREFIX', 'api/v1').replace(/^\/|\/$/g, '');
    return {
      id: i.id,
      provider: i.provider,
      enabled: !i.disabledAt,
      webhookUrl: `${base}/${prefix}/ats/webhooks/${i.id}`,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    };
  }
}
