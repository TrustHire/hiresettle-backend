import { MaintenanceModeService } from './maintenance-mode.service';

describe('MaintenanceModeService', () => {
  const prisma = {
    systemConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  } as any;
  let service: MaintenanceModeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MaintenanceModeService(prisma);
  });

  it('treats an absent or non-true value as disabled', async () => {
    prisma.systemConfig.findUnique.mockResolvedValueOnce(null);
    expect(await service.isEnabled()).toBe(false);

    prisma.systemConfig.findUnique.mockResolvedValueOnce({ value: 'false' });
    expect(await service.isEnabled()).toBe(false);
  });

  it('reads the persisted maintenance flag', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });

    await expect(service.isEnabled()).resolves.toBe(true);
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({
      where: { key: 'maintenance_mode' },
    });
  });

  it('upserts the flag and returns its new state', async () => {
    await expect(service.setEnabled(true)).resolves.toEqual({ enabled: true });
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'maintenance_mode' },
      create: { key: 'maintenance_mode', value: 'true' },
      update: { value: 'true' },
    });
  });
});