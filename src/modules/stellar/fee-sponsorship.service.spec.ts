import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Account,
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { FeeSponsorshipService } from './fee-sponsorship.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('FeeSponsorshipService', () => {
  let service: FeeSponsorshipService;
  let configValues: Record<string, string | undefined>;
  let config: { get: jest.Mock };
  let stellar: { getNetworkPassphrase: jest.Mock; getHorizonUrl: jest.Mock };
  let prisma: {
    sponsoredFee: {
      aggregate: jest.Mock;
      create: jest.Mock;
    };
  };

  const sponsorKeypair = Keypair.random();
  const userKeypair = Keypair.random();

  function buildSignedUserTx(): Transaction {
    const account = new Account(userKeypair.publicKey(), '10');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: sponsorKeypair.publicKey(),
          asset: require('@stellar/stellar-sdk').Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build();
    tx.sign(userKeypair);
    return tx;
  }

  beforeEach(async () => {
    configValues = {
      ENABLE_FEE_SPONSORSHIP: 'true',
      STELLAR_FEE_SPONSOR_SECRET: sponsorKeypair.secret(),
      FEE_SPONSORSHIP_DAILY_CAP_XLM: '100',
      FEE_SPONSORSHIP_MAX_FEE_STROOPS: '100000',
      FEE_SPONSORSHIP_WARN_RATIO: '0.8',
    };
    config = {
      get: jest.fn((key: string) => configValues[key]),
    };
    stellar = {
      getNetworkPassphrase: jest.fn().mockReturnValue(Networks.TESTNET),
      getHorizonUrl: jest.fn().mockReturnValue('https://horizon-testnet.stellar.org'),
    };
    prisma = {
      sponsoredFee: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { feeStroops: BigInt(0) } }),
        create: jest.fn().mockResolvedValue({ id: 'sf-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeSponsorshipService,
        { provide: ConfigService, useValue: config },
        { provide: StellarService, useValue: stellar },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FeeSponsorshipService>(FeeSponsorshipService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('reports enabled state and numeric caps from config', () => {
    expect(service.isEnabled()).toBe(true);
    expect(service.dailyCapStroops).toBe(100 * 10_000_000);
    expect(service.maxFeeStroops).toBe(100_000);

    configValues.ENABLE_FEE_SPONSORSHIP = 'false';
    expect(service.isEnabled()).toBe(false);
  });

  describe('wrap', () => {
    it('throws BadRequestException when sponsor keypair is not configured', () => {
      delete configValues.STELLAR_FEE_SPONSOR_SECRET;
      delete configValues.STELLAR_SECRET_KEY;
      const tx = buildSignedUserTx();

      expect(() => service.wrap(tx)).toThrow(BadRequestException);
    });

    it('wraps inner transaction in a signed FeeBumpTransaction', () => {
      const tx = buildSignedUserTx();

      const feeBump = service.wrap(tx, 100_000);

      expect(feeBump).toBeInstanceOf(FeeBumpTransaction);
      expect(feeBump.feeSource).toBe(sponsorKeypair.publicKey());
      expect(feeBump.signatures.length).toBe(1);
    });
  });

  describe('assertWithinBudget', () => {
    it('throws BadRequestException when projected spend exceeds daily cap', async () => {
      configValues.FEE_SPONSORSHIP_DAILY_CAP_XLM = '1'; // 10_000_000 stroops
      prisma.sponsoredFee.aggregate.mockResolvedValue({
        _sum: { feeStroops: BigInt(9_950_000) },
      });

      await expect(service.assertWithinBudget(100_000)).rejects.toThrow(
        'Daily fee sponsorship budget exhausted',
      );
    });

    it('allows spend within daily cap', async () => {
      prisma.sponsoredFee.aggregate.mockResolvedValue({
        _sum: { feeStroops: BigInt(1000) },
      });

      await expect(service.assertWithinBudget(100_000)).resolves.toBeUndefined();
    });
  });

  describe('submit', () => {
    it('throws BadRequestException if transaction is already a fee-bump', async () => {
      const inner = buildSignedUserTx();
      const feeBump = service.wrap(inner);

      await expect(service.submit(feeBump.toXDR(), 'comp-1')).rejects.toThrow(
        'Transaction is already a fee-bump transaction',
      );
    });

    it('submits inner tx directly without recording when sponsorship is disabled', async () => {
      configValues.ENABLE_FEE_SPONSORSHIP = 'false';
      const inner = buildSignedUserTx();
      const submitSpy = jest
        .spyOn(Horizon.Server.prototype, 'submitTransaction')
        .mockResolvedValue({ hash: 'direct-hash' } as any);

      const res = await service.submit(inner.toXDR(), 'comp-1');

      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ hash: 'direct-hash', sponsored: false, feeStroops: null });
      expect(prisma.sponsoredFee.create).not.toHaveBeenCalled();
    });

    it('wraps, submits, and records fee when sponsorship is enabled', async () => {
      const inner = buildSignedUserTx();
      const submitSpy = jest
        .spyOn(Horizon.Server.prototype, 'submitTransaction')
        .mockResolvedValue({ hash: 'bumped-hash', fee_charged: '2500' } as any);

      const res = await service.submit(inner.toXDR(), 'comp-1');

      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(prisma.sponsoredFee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'comp-1',
          txHash: 'bumped-hash',
          feeStroops: BigInt(2500),
          feeSource: sponsorKeypair.publicKey(),
        }),
      });
      expect(res).toEqual({ hash: 'bumped-hash', sponsored: true, feeStroops: '2500' });
    });
  });
});
