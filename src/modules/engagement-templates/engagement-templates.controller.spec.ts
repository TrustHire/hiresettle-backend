import { Test, TestingModule } from '@nestjs/testing';
import { EngagementTemplatesController } from './engagement-templates.controller';
import { EngagementTemplatesService } from './engagement-templates.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EngagementTemplatesController', () => {
  let controller: EngagementTemplatesController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    clone: jest.Mock;
    adopt: jest.Mock;
    importTemplate: jest.Mock;
    exportTemplate: jest.Mock;
    getStats: jest.Mock;
  };

  const mockUser = { id: 'user-1', companyId: 'company-1', role: 'ADMIN' };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      clone: jest.fn(),
      adopt: jest.fn(),
      importTemplate: jest.fn(),
      exportTemplate: jest.fn(),
      getStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EngagementTemplatesController],
      providers: [
        { provide: EngagementTemplatesService, useValue: service },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<EngagementTemplatesController>(
      EngagementTemplatesController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('returns templates for the current company', async () => {
      const templates = [{ id: 't1' }];
      service.findAll.mockResolvedValue(templates);

      await expect(controller.findAll(mockUser as any)).resolves.toEqual(
        templates,
      );
      expect(service.findAll).toHaveBeenCalledWith(mockUser.companyId);
    });
  });

  describe('findOne', () => {
    it('returns a single template', async () => {
      const template = { id: 't1' };
      service.findOne.mockResolvedValue(template);

      await expect(
        controller.findOne('t1', mockUser as any),
      ).resolves.toEqual(template);
      expect(service.findOne).toHaveBeenCalledWith('t1', mockUser.companyId);
    });

    it('propagates not-found errors', async () => {
      service.findOne.mockRejectedValue(new Error('Not found'));

      await expect(
        controller.findOne('missing', mockUser as any),
      ).rejects.toThrow('Not found');
    });
  });

  describe('create', () => {
    it('creates a template scoped to the company', async () => {
      const dto = { name: 'Welcome' } as any;
      const created = { id: 't1', ...dto };
      service.create.mockResolvedValue(created);

      await expect(controller.create(dto, mockUser as any)).resolves.toEqual(
        created,
      );
      expect(service.create).toHaveBeenCalledWith(dto, mockUser.companyId);
    });

    it('propagates validation failures', async () => {
      service.create.mockRejectedValue(new Error('Validation failed'));

      await expect(
        controller.create({} as any, mockUser as any),
      ).rejects.toThrow('Validation failed');
    });
  });

  describe('update', () => {
    it('updates a template', async () => {
      const dto = { name: 'Updated' } as any;
      const updated = { id: 't1', ...dto };
      service.update.mockResolvedValue(updated);

      await expect(
        controller.update('t1', dto, mockUser as any),
      ).resolves.toEqual(updated);
      expect(service.update).toHaveBeenCalledWith(
        't1',
        dto,
        mockUser.companyId,
      );
    });

    it('propagates authorization errors', async () => {
      service.update.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.update('t1', {} as any, mockUser as any),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('remove', () => {
    it('removes a template', async () => {
      service.remove.mockResolvedValue({ id: 't1' });

      await expect(
        controller.remove('t1', mockUser as any),
      ).resolves.toEqual({ id: 't1' });
      expect(service.remove).toHaveBeenCalledWith('t1', mockUser.companyId);
    });
  });

  describe('clone', () => {
    it('clones a template', async () => {
      const cloned = { id: 't2' };
      service.clone.mockResolvedValue(cloned);

      await expect(
        controller.clone('t1', mockUser as any),
      ).resolves.toEqual(cloned);
      expect(service.clone).toHaveBeenCalledWith('t1', mockUser.companyId);
    });

    it('propagates authorization errors', async () => {
      service.clone.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.clone('t1', mockUser as any),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('adopt', () => {
    it('adopts a template', async () => {
      const adopted = { id: 't2' };
      service.adopt.mockResolvedValue(adopted);

      await expect(
        controller.adopt('t1', mockUser as any),
      ).resolves.toEqual(adopted);
      expect(service.adopt).toHaveBeenCalledWith('t1', mockUser.companyId);
    });

    it('propagates authorization errors', async () => {
      service.adopt.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.adopt('t1', mockUser as any),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('importTemplate', () => {
    it('imports a template payload', async () => {
      const payload = { name: 'Imported' } as any;
      const imported = { id: 't3' };
      service.importTemplate.mockResolvedValue(imported);

      await expect(
        controller.importTemplate(payload, mockUser as any),
      ).resolves.toEqual(imported);
      expect(service.importTemplate).toHaveBeenCalledWith(
        payload,
        mockUser.companyId,
      );
    });

    it('propagates validation failures', async () => {
      service.importTemplate.mockRejectedValue(new Error('Invalid payload'));

      await expect(
        controller.importTemplate({} as any, mockUser as any),
      ).rejects.toThrow('Invalid payload');
    });
  });

  describe('exportTemplate', () => {
    it('exports a template', async () => {
      const exported = { name: 'Exported' };
      service.exportTemplate.mockResolvedValue(exported);

      await expect(
        controller.exportTemplate('t1', mockUser as any),
      ).resolves.toEqual(exported);
      expect(service.exportTemplate).toHaveBeenCalledWith(
        't1',
        mockUser.companyId,
      );
    });
  });

  describe('getStats', () => {
    it('returns stats for the company', async () => {
      const stats = { total: 3, adopted: 1 };
      service.getStats.mockResolvedValue(stats);

      await expect(controller.getStats(mockUser as any)).resolves.toEqual(
        stats,
      );
      expect(service.getStats).toHaveBeenCalledWith(mockUser.companyId);
    });
  });
});
