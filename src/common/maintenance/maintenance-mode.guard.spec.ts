import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MaintenanceModeGuard } from './maintenance-mode.guard';
import { MaintenanceModeService } from './maintenance-mode.service';

describe('MaintenanceModeGuard', () => {
  const maintenanceMode = { isEnabled: jest.fn() } as any;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  let guard: MaintenanceModeGuard;

  const contextFor = (method: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new MaintenanceModeGuard(
      maintenanceMode as MaintenanceModeService,
      reflector,
    );
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s during maintenance', async (method) => {
    maintenanceMode.isEnabled.mockResolvedValue(true);

    await expect(guard.canActivate(contextFor(method))).resolves.toBe(true);
    expect(maintenanceMode.isEnabled).not.toHaveBeenCalled();
  });

  it('rejects writes with 503 while maintenance is enabled', async () => {
    maintenanceMode.isEnabled.mockResolvedValue(true);

    await expect(guard.canActivate(contextFor('POST'))).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 503,
      }),
      status: 503,
    });
  });

  it('allows writes when maintenance is disabled', async () => {
    maintenanceMode.isEnabled.mockResolvedValue(false);

    await expect(guard.canActivate(contextFor('PATCH'))).resolves.toBe(true);
  });

  it('allows a decorated maintenance toggle write', async () => {
    maintenanceMode.isEnabled.mockResolvedValue(true);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

    await expect(guard.canActivate(contextFor('PUT'))).resolves.toBe(true);
    expect(maintenanceMode.isEnabled).not.toHaveBeenCalled();
  });
});