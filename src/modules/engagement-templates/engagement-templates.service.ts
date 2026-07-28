import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateEngagementTemplateDto } from './dto/create-engagement-template.dto';
import { UpdateEngagementTemplateDto } from './dto/update-engagement-template.dto';

@Injectable()
export class EngagementTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateEngagementTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.engagementTemplate.create({
        data: {
          companyId,
          name: dto.name,
          jobTitle: dto.jobTitle,
          jobDescription: dto.jobDescription,
          salaryRange: dto.salaryRange,
          location: dto.location,
          milestoneConfig: dto.milestoneConfig,
          currentVersion: 1,
        },
      });

      await tx.engagementTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          name: template.name,
          jobTitle: template.jobTitle,
          jobDescription: template.jobDescription,
          salaryRange: template.salaryRange,
          location: template.location,
          milestoneConfig: template.milestoneConfig,
        },
      });

      return template;
    });
  }

  async findAll(companyId: string) {
    return this.prisma.engagementTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const template = await this.prisma.engagementTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    if (template.companyId !== companyId) throw new ForbiddenException('Not authorized to access this template');
    return template;
  }

  async findVersions(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.engagementTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: 'desc' },
    });
  }

  // Updates never mutate a template's published fields in place — they create a new
  // immutable version snapshot and advance the template's currentVersion to point at it.
  // Past engagements keep their existing templateVersionId, so their referenced content
  // never changes underneath them.
  async update(id: string, companyId: string, dto: UpdateEngagementTemplateDto) {
    const existing = await this.findOne(id, companyId);
    const merged = {
      name: dto.name ?? existing.name,
      jobTitle: dto.jobTitle ?? existing.jobTitle,
      jobDescription: dto.jobDescription ?? existing.jobDescription,
      salaryRange: dto.salaryRange ?? existing.salaryRange,
      location: dto.location ?? existing.location,
      milestoneConfig: dto.milestoneConfig ?? existing.milestoneConfig,
    };
    const nextVersion = existing.currentVersion + 1;

    return this.prisma.$transaction(async (tx) => {
      await tx.engagementTemplateVersion.create({
        data: { templateId: id, version: nextVersion, ...merged },
      });

      return tx.engagementTemplate.update({
        where: { id },
        data: { ...merged, currentVersion: nextVersion },
      });
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    await this.prisma.engagementTemplate.delete({
      where: { id },
    });
    return { success: true };
  }

  async clone(id: string, companyId: string, name?: string) {
    const source = await this.findOne(id, companyId);
    return this.create(companyId, {
      name: name ?? `${source.name} (copy)`,
      jobTitle: source.jobTitle,
      jobDescription: source.jobDescription ?? undefined,
      salaryRange: source.salaryRange ?? undefined,
      location: source.location ?? undefined,
      milestoneConfig: source.milestoneConfig,
    });
  }
}
