import { StellarBalanceAlertService } from './stellar-balance-alert.service';

describe('StellarBalanceAlertService', () => {
  const config = { get: jest.fn() } as any;
  const prisma = {
    systemConfig: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findMany: jest.fn() },
  } as any;
  const stellar = {
    getBackendAccountAddress: jest.fn(),
    getBackendAccountBalance: jest.fn(),
  } as any;
  const notifications = { notifyUserById: jest.fn() } as any;
  let service: StellarBalanceAlertService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((_key: string, fallback: unknown) => fallback);
    service = new StellarBalanceAlertService(config, prisma, stellar, notifications);
  });

  afterEach(() => service.onModuleDestroy());

  it('notifies active admins only once while a breach remains active', async () => {
    stellar.getBackendAccountAddress.mockReturnValue('GABC');
    stellar.getBackendAccountBalance.mockResolvedValue(5n);
    prisma.systemConfig.findUnique.mockResolvedValue({ value: 'false' });
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    await service.checkBalance();
    await service.checkBalance();

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(notifications.notifyUserById).toHaveBeenCalledTimes(2);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { key: 'stellar_balance_alert_breached', value: 'true' },
    }));
  });

  it('clears the breach marker after the balance recovers', async () => {
    stellar.getBackendAccountAddress.mockReturnValue('GABC');
    stellar.getBackendAccountBalance.mockResolvedValue(20_000_000n);
    prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });

    await service.checkBalance();

    expect(notifications.notifyUserById).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'stellar_balance_alert_breached' },
      create: { key: 'stellar_balance_alert_breached', value: 'false' },
      update: { value: 'false' },
    });
  });
});