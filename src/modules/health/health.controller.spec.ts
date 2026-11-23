import { Test, TestingModule } from '@nestjs/testing';
import {
  DiskHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { QueueHealthIndicator } from './queue-health.indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let memory: { checkHeap: jest.Mock; checkRSS: jest.Mock };
  let disk: { checkStorage: jest.Mock };
  let healthService: {
    isDatabaseHealthy: jest.Mock;
    isStellarHorizonHealthy: jest.Mock;
  };
  let queueHealth: { isHealthy: jest.Mock };

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
        const results = await Promise.all(indicators.map((fn) => fn()));
        return { status: 'ok', details: results };
      }),
    };
    memory = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
      checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
    };
    disk = {
      checkStorage: jest.fn().mockResolvedValue({ disk_storage: { status: 'up' } }),
    };
    healthService = {
      isDatabaseHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
      isStellarHorizonHealthy: jest.fn().mockResolvedValue({ stellarHorizon: { status: 'up' } }),
    };
    queueHealth = {
      isHealthy: jest.fn().mockResolvedValue({ queues: { status: 'up' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: MemoryHealthIndicator, useValue: memory },
        { provide: DiskHealthIndicator, useValue: disk },
        { provide: HealthService, useValue: healthService },
        { provide: QueueHealthIndicator, useValue: queueHealth },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('live() runs an empty health check without hitting external indicators', async () => {
    const res = await controller.live();

    expect(healthCheckService.check).toHaveBeenCalledWith([]);
    expect(healthService.isDatabaseHealthy).not.toHaveBeenCalled();
    expect(healthService.isStellarHorizonHealthy).not.toHaveBeenCalled();
    expect(queueHealth.isHealthy).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'ok', details: [] });
  });

  it('ready() runs all 6 readiness indicators', async () => {
    const res = await controller.ready();

    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    expect(healthService.isDatabaseHealthy).toHaveBeenCalledTimes(1);
    expect(healthService.isStellarHorizonHealthy).toHaveBeenCalledTimes(1);
    expect(queueHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 150 * 1024 * 1024);
    expect(memory.checkRSS).toHaveBeenCalledWith('memory_rss', 150 * 1024 * 1024);
    expect(disk.checkStorage).toHaveBeenCalledWith('disk_storage', {
      path: '/',
      thresholdPercent: 0.75,
    });
    expect(res.status).toBe('ok');
  });

  it('check() runs all 6 health indicators', async () => {
    const res = await controller.check();

    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    expect(healthService.isDatabaseHealthy).toHaveBeenCalledTimes(1);
    expect(healthService.isStellarHorizonHealthy).toHaveBeenCalledTimes(1);
    expect(queueHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 150 * 1024 * 1024);
    expect(memory.checkRSS).toHaveBeenCalledWith('memory_rss', 150 * 1024 * 1024);
    expect(disk.checkStorage).toHaveBeenCalledWith('disk_storage', {
      path: '/',
      thresholdPercent: 0.75,
    });
    expect(res.status).toBe('ok');
  });
});
