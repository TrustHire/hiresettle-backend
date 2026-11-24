import { Test, TestingModule } from '@nestjs/testing';
import { StatusController } from './status.controller';
import { HealthService } from './health.service';

describe('StatusController', () => {
  let controller: StatusController;
  let healthService: {
    isDatabaseHealthy: jest.Mock;
    isStellarHorizonHealthy: jest.Mock;
  };

  beforeEach(async () => {
    healthService = {
      isDatabaseHealthy: jest.fn(),
      isStellarHorizonHealthy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<StatusController>(StatusController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns status up when both database and stellar are up', async () => {
    healthService.isDatabaseHealthy.mockResolvedValue({ database: { status: 'up' } });
    healthService.isStellarHorizonHealthy.mockResolvedValue({ stellarHorizon: { status: 'up' } });

    const res = await controller.getStatus();

    expect(res.status).toBe('up');
    expect(res.services).toEqual({
      api: 'up',
      database: 'up',
      stellar: 'up',
    });
    expect(new Date(res.timestamp).toISOString()).toBe(res.timestamp);
  });

  it('returns degraded when database is down', async () => {
    healthService.isDatabaseHealthy.mockResolvedValue({ database: { status: 'down' } });
    healthService.isStellarHorizonHealthy.mockResolvedValue({ stellarHorizon: { status: 'up' } });

    const res = await controller.getStatus();

    expect(res.status).toBe('degraded');
    expect(res.services).toEqual({
      api: 'up',
      database: 'down',
      stellar: 'up',
    });
  });

  it('returns degraded when stellar horizon is down', async () => {
    healthService.isDatabaseHealthy.mockResolvedValue({ database: { status: 'up' } });
    healthService.isStellarHorizonHealthy.mockResolvedValue({ stellarHorizon: { status: 'down' } });

    const res = await controller.getStatus();

    expect(res.status).toBe('degraded');
    expect(res.services).toEqual({
      api: 'up',
      database: 'up',
      stellar: 'down',
    });
  });

  it('returns degraded when both database and stellar are down', async () => {
    healthService.isDatabaseHealthy.mockResolvedValue({ database: { status: 'down' } });
    healthService.isStellarHorizonHealthy.mockResolvedValue({ stellarHorizon: { status: 'down' } });

    const res = await controller.getStatus();

    expect(res.status).toBe('degraded');
    expect(res.services).toEqual({
      api: 'up',
      database: 'down',
      stellar: 'down',
    });
  });
});
