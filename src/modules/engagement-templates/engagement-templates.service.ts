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
    const template = await this.prisma.engagementTemplate.create({
      data: {
        companyId,
        name: dto.name,
        jobTitle: dto.jobTitle,
        jobDescription: dto.jobDescription,
        salaryRange: dto.salaryRange,
        location: dto.location,
        milestoneConfig: dto.milestoneConfig,
      },
    });
    return template;
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

  async update(id: string, companyId: string, dto: UpdateEngagementTemplateDto) {
    await this.findOne(id, companyId);
    return this.prisma.engagementTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    await this.prisma.engagementTemplate.delete({
      where: { id },
    });
    return { success: true };
  }
}
