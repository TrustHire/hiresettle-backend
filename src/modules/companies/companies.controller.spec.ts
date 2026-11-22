import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CompaniesController', () => {
  let controller: CompaniesController;
  let service: {
    getProofSlaSettings: jest.Mock;
    updateProofSlaSettings: jest.Mock;
    transferOwnership: jest.Mock;
    getEngagementStats: jest.Mock;
    getMembers: jest.Mock;
    getBilling: jest.Mock;
  };

  const companyId = 'company-1';
  const userId = 'user-1';

  beforeEach(async () => {
    service = {
      getProofSlaSettings: jest.fn(),
      updateProofSlaSettings: jest.fn(),
      transferOwnership: jest.fn(),
      getEngagementStats: jest.fn(),
      getMembers: jest.fn(),
      getBilling: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: CompaniesService, useValue: service },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CompaniesController>(CompaniesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('proof SLA settings', () => {
    it('returns current SLA settings', async () => {
      const settings = { proofSlaHours: 24, reminderSlaHours: 48 };
      service.getProofSlaSettings.mockResolvedValue(settings);

      await expect(controller.getProofSlaSettings(companyId)).resolves.toEqual(settings);
      expect(service.getProofSlaSettings).toHaveBeenCalledWith(companyId);
    });

    it('updates SLA settings', async () => {
      const dto = { proofSlaHours: 12, reminderSlaHours: 36 };
      service.updateProofSlaSettings.mockResolvedValue(dto);

      await expect(controller.updateProofSlaSettings(companyId, dto)).resolves.toEqual(dto);
      expect(service.updateProofSlaSettings).toHaveBeenCalledWith(companyId, dto);
    });

    it('propagates validation failures from the service', async () => {
      service.updateProofSlaSettings.mockRejectedValue(new Error('Invalid SLA hours'));

      await expect(
        controller.updateProofSlaSettings(companyId, { proofSlaHours: -1 }),
      ).rejects.toThrow('Invalid SLA hours');
    });
  });

  describe('ownership transfer', () => {
    it('transfers ownership to a new owner', async () => {
      const dto = { newOwnerId: 'user-2' };
      service.transferOwnership.mockResolvedValue({ success: true });

      await expect(controller.transferOwnership(companyId, dto, userId)).resolves.toEqual({
        success: true,
      });
      expect(service.transferOwnership).toHaveBeenCalledWith(companyId, dto, userId);
    });

    it('rejects unauthorized transfer attempts', async () => {
      service.transferOwnership.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.transferOwnership(companyId, { newOwnerId: 'user-2' }, 'intruder'),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('engagement stats', () => {
    it('returns engagement statistics', async () => {
      const stats = { views: 10, applications: 3 };
      service.getEngagementStats.mockResolvedValue(stats);

      await expect(controller.getEngagementStats(companyId)).resolves.toEqual(stats);
      expect(service.getEngagementStats).toHaveBeenCalledWith(companyId);
    });
  });

  describe('members', () => {
    it('lists company members', async () => {
      const members = [{ id: 'm1', role: 'ADMIN' }];
      service.getMembers.mockResolvedValue(members);

      await expect(controller.getMembers(companyId)).resolves.toEqual(members);
      expect(service.getMembers).toHaveBeenCalledWith(companyId);
    });
  });

  describe('billing', () => {
    it('returns billing information', async () => {
      const billing = { plan: 'pro', seats: 5 };
      service.getBilling.mockResolvedValue(billing);

      await expect(controller.getBilling(companyId)).resolves.toEqual(billing);
      expect(service.getBilling).toHaveBeenCalledWith(companyId);
    });

    it('propagates authorization errors', async () => {
      service.getBilling.mockRejectedValue(new Error('Forbidden'));

      await expect(controller.getBilling(companyId)).rejects.toThrow('Forbidden');
    });
  });
});
