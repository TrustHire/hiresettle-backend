import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EngagementTemplatesService } from './engagement-templates.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EngagementTemplatesService', () => {
  let service: EngagementTemplatesService;
  let prisma: {
    engagementTemplate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };

  const baseTemplate = {
    id: 'tpl-1',
    name: 'Standard Engagement',
    description: 'Default template',
    version: 1,
    isLatest: true,
    parentId: null,
    ownerId: 'user-1',
    companyId: 'company-1',
    content: { clauses: ['a', 'b'] },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      engagementTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementTemplatesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EngagementTemplatesService>(EngagementTemplatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns templates for a company', async () => {
      prisma.engagementTemplate.findMany.mockResolvedValue([baseTemplate]);
      const result = await service.findAll('company-1');
      expect(result).toEqual([baseTemplate]);
      expect(prisma.engagementTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1' }) }),
      );
    });

    it('returns empty list when none exist', async () => {
      prisma.engagementTemplate.findMany.mockResolvedValue([]);
      await expect(service.findAll('company-1')).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('returns a template by id', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(baseTemplate);
      await expect(service.findOne('tpl-1')).resolves.toEqual(baseTemplate);
    });

    it('throws NotFoundException when missing', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a template with version 1', async () => {
      prisma.engagementTemplate.create.mockResolvedValue(baseTemplate);
      const dto = { name: 'Standard Engagement', companyId: 'company-1', content: { clauses: [] } };
      const result = await service.create(dto as any, 'user-1');
      expect(result).toEqual(baseTemplate);
      expect(prisma.engagementTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1, isLatest: true, ownerId: 'user-1' }),
        }),
      );
    });

    it('rejects empty name', async () => {
      await expect(
        service.create({ name: '', companyId: 'company-1', content: {} } as any, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.engagementTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('versioning', () => {
    it('creates a new version and marks previous as not latest', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(baseTemplate);
      prisma.engagementTemplate.update.mockResolvedValue({ ...baseTemplate, isLatest: false });
      prisma.engagementTemplate.create.mockResolvedValue({
        ...baseTemplate,
        id: 'tpl-2',
        version: 2,
        parentId: 'tpl-1',
      });

      const result = await service.createVersion('tpl-1', { content: { clauses: ['c'] } } as any, 'user-1');

      expect(result.version).toBe(2);
      expect(prisma.engagementTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl-1' }, data: { isLatest: false } }),
      );
    });

    it('throws NotFoundException when versioning missing template', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.createVersion('missing', {} as any, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbids versioning a template owned by another user', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue({ ...baseTemplate, ownerId: 'other' });
      await expect(
        service.createVersion('tpl-1', {} as any, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('clone', () => {
    it('clones a template into a new record', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(baseTemplate);
      prisma.engagementTemplate.create.mockResolvedValue({ ...baseTemplate, id: 'tpl-clone' });

      const result = await service.clone('tpl-1', 'user-1');

      expect(result.id).toBe('tpl-clone');
      expect(prisma.engagementTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1, isLatest: true, ownerId: 'user-1' }),
        }),
      );
    });

    it('throws NotFoundException when cloning missing template', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.clone('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('adopt', () => {
    it('adopts a template for a company', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(baseTemplate);
      prisma.engagementTemplate.create.mockResolvedValue({ ...baseTemplate, id: 'tpl-adopted', companyId: 'company-2' });

      const result = await service.adopt('tpl-1', 'company-2', 'user-1');

      expect(result.companyId).toBe('company-2');
      expect(prisma.engagementTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-2', ownerId: 'user-1' }),
        }),
      );
    });

    it('throws NotFoundException when adopting missing template', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.adopt('missing', 'company-2', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('import/export', () => {
    it('exports a template as a serializable payload', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(baseTemplate);
      const exported = await service.exportTemplate('tpl-1');
      expect(exported).toEqual(
        expect.objectContaining({ name: baseTemplate.name, content: baseTemplate.content }),
      );
    });

    it('throws NotFoundException when exporting missing template', async () => {
      prisma.engagementTemplate.findUnique.mockResolvedValue(null);
      await expect(service.exportTemplate('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('imports a template payload', async () => {
      prisma.engagementTemplate.create.mockResolvedValue(baseTemplate);
      const payload = { name: 'Imported', content: { clauses: [] } };
      const result = await service.importTemplate(payload as any, 'company-1', 'user-1');
      expect(result).toEqual(baseTemplate);
      expect(prisma.engagementTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Imported', companyId: 'company-1', ownerId: 'user-1' }),
        }),
      );
    });

    it('rejects invalid import payload', async () => {
      await expect(
        service.importTemplate({} as any, 'company-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.engagementTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('stats', () => {
    it('returns aggregate stats for a company', async () => {
      prisma.engagementTemplate.count.mockResolvedValue(3);
      prisma.engagementTemplate.findMany.mockResolvedValue([baseTemplate]);

      const result = await service.getStats('company-1');

      expect(result).toEqual(
        expect.objectContaining({ total: 3, latest: expect.any(Number) }),
      );
    });

    it('returns zeroed stats when no templates exist', async () => {
      prisma.engagementTemplate.count.mockResolvedValue(0);
      prisma.engagementTemplate.findMany.mockResolvedValue([]);

      const result = await service.getStats('company-1');

      expect(result.total).toBe(0);
    });
  });
});
