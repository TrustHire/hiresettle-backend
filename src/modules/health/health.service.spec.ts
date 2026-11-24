import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { HorizonFailoverService } from '../../common/stellar/horizon-failover.service';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: jest.Mock };
  let stellar: { getLatestLedger: jest.Mock };
  let horizonFailover: { activeUrl: string; endpointStatus: Array<{ url: string; healthy: boolean }> };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    stellar = { getLatestLedger: jest.fn() };
    horizonFailover = {
      activeUrl: 'https://horizon-testnet.stellar.org',
      endpointStatus: [{ url: 'https://horizon-testnet.stellar.org', healthy: true }],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: StellarService, useValue: stellar },
        { provide: HorizonFailoverService, useValue: horizonFailover },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isDatabaseHealthy', () => {
    it('returns up when SELECT 1 succeeds', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await service.isDatabaseHealthy();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ database: { status: 'up' } });
    });

    it('returns down with error message when database query fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

      const result = await service.isDatabaseHealthy();

      expect(result).toEqual({
        database: { status: 'down', message: 'connection refused' },
      });
    });
  });

  describe('isStellarHorizonHealthy', () => {
    it('returns up with activeEndpoint and endpoints when Horizon responds', async () => {
      stellar.getLatestLedger.mockResolvedValue(12345);

      const result = await service.isStellarHorizonHealthy();

      expect(stellar.getLatestLedger).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        stellarHorizon: {
          status: 'up',
          activeEndpoint: 'https://horizon-testnet.stellar.org',
          endpoints: [{ url: 'https://horizon-testnet.stellar.org', healthy: true }],
        },
      });
    });

    it('returns down with message and endpoint status when Horizon fails', async () => {
      stellar.getLatestLedger.mockRejectedValue(new Error('Horizon timeout'));
      horizonFailover.endpointStatus = [
        { url: 'https://horizon-testnet.stellar.org', healthy: false },
      ];

      const result = await service.isStellarHorizonHealthy();

      expect(result).toEqual({
        stellarHorizon: {
          status: 'down',
          message: 'Horizon timeout',
          activeEndpoint: 'https://horizon-testnet.stellar.org',
          endpoints: [{ url: 'https://horizon-testnet.stellar.org', healthy: false }],
        },
      });
    });
  });
});
