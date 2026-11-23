import { Test, TestingModule } from '@nestjs/testing';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { StellarController } from './stellar.controller';
import { StellarService } from '../../common/stellar/stellar.service';
import { StellarTxStatusService } from './stellar-tx-status.service';
import { FeeSponsorshipService } from './fee-sponsorship.service';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';

describe('StellarController', () => {
  let controller: StellarController;
  let stellarService: {
    getBalance: jest.Mock;
    getFeeEstimate: jest.Mock;
  };
  let txStatus: { getStatus: jest.Mock };
  let feeSponsorship: { submit: jest.Mock };

  beforeEach(async () => {
    stellarService = {
      getBalance: jest.fn(),
      getFeeEstimate: jest.fn(),
    };
    txStatus = { getStatus: jest.fn() };
    feeSponsorship = { submit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StellarController],
      providers: [
        { provide: StellarService, useValue: stellarService },
        { provide: StellarTxStatusService, useValue: txStatus },
        { provide: FeeSponsorshipService, useValue: feeSponsorship },
      ],
    })
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(CacheInterceptor)
      .useValue({ intercept: (_ctx: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();

    controller = module.get<StellarController>(StellarController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('defaults token to native when omitted', async () => {
      stellarService.getBalance.mockResolvedValue({ balance: BigInt(15000000) });

      const result = await controller.getBalance('GABC123');

      expect(stellarService.getBalance).toHaveBeenCalledWith('GABC123', 'native');
      expect(result).toEqual({
        address: 'GABC123',
        token: 'native',
        balance: '15000000',
      });
    });

    it('passes custom token address when provided', async () => {
      stellarService.getBalance.mockResolvedValue({ balance: '42.5' });

      const result = await controller.getBalance('GABC123', 'USDC:GISSUER');

      expect(stellarService.getBalance).toHaveBeenCalledWith('GABC123', 'USDC:GISSUER');
      expect(result).toEqual({
        address: 'GABC123',
        token: 'USDC:GISSUER',
        balance: '42.5',
      });
    });
  });

  describe('getFeeEstimate', () => {
    it('returns fee estimate from StellarService', async () => {
      const estimate = { baseFee: 100, recommendedSorobanFee: 500 };
      stellarService.getFeeEstimate.mockResolvedValue(estimate);

      const result = await controller.getFeeEstimate();

      expect(stellarService.getFeeEstimate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(estimate);
    });
  });

  describe('getTxStatus', () => {
    it('delegates transaction status lookup to StellarTxStatusService', async () => {
      const status = { hash: 'txhash', status: 'success', cached: false };
      txStatus.getStatus.mockResolvedValue(status);

      const result = await controller.getTxStatus('txhash');

      expect(txStatus.getStatus).toHaveBeenCalledWith('txhash');
      expect(result).toEqual(status);
    });
  });

  describe('submitSponsored', () => {
    it('delegates sponsored submission to FeeSponsorshipService', async () => {
      const response = { hash: 'sponsored-hash', sponsored: true, feeStroops: '1000' };
      feeSponsorship.submit.mockResolvedValue(response);

      const result = await controller.submitSponsored({
        xdr: 'AAAA...',
        companyId: 'comp-1',
      });

      expect(feeSponsorship.submit).toHaveBeenCalledWith('AAAA...', 'comp-1');
      expect(result).toEqual(response);
    });
  });
});
