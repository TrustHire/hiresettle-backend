import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { xdr } from '@stellar/stellar-sdk';
import { StellarTxStatusService } from './stellar-tx-status.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { CacheService } from '../../common/cache/cache.service';

describe('StellarTxStatusService', () => {
  let service: StellarTxStatusService;
  let stellar: { getHorizonUrl: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(async () => {
    stellar = { getHorizonUrl: jest.fn().mockReturnValue('https://horizon-testnet.stellar.org') };
    cache = { get: jest.fn(), set: jest.fn() };
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarTxStatusService,
        { provide: StellarService, useValue: stellar },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<StellarTxStatusService>(StellarTxStatusService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns cached response with cached=true without calling Horizon', async () => {
    cache.get.mockResolvedValue({
      hash: 'abc',
      status: 'success',
      ledger: 100,
      createdAt: '2026-01-01T00:00:00Z',
      feeCharged: '100',
      resultCode: 'txSuccess',
      operationResultCodes: [],
      cached: false,
    });

    const result = await service.getStatus('abc');

    expect(result.cached).toBe(true);
    expect(result.status).toBe('success');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when Horizon returns 404', async () => {
    cache.get.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue({ status: 404, ok: false });

    await expect(service.getStatus('missing-hash')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Error when Horizon returns a non-404 error status', async () => {
    cache.get.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue({ status: 503, ok: false });

    await expect(service.getStatus('err-hash')).rejects.toThrow(
      'Horizon returned 503 for transaction err-hash',
    );
  });

  it('returns pending without caching when ledger is absent', async () => {
    cache.get.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        ledger: null,
        successful: false,
        created_at: null,
        fee_charged: null,
        result_xdr: null,
      }),
    });

    const result = await service.getStatus('pending-hash');

    expect(result).toEqual({
      hash: 'pending-hash',
      status: 'pending',
      ledger: null,
      createdAt: null,
      feeCharged: null,
      resultCode: null,
      operationResultCodes: [],
      cached: false,
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('caches final success status for 7 days', async () => {
    cache.get.mockResolvedValue(null);
    const txResult = new xdr.TransactionResult({
      feeCharged: xdr.Int64.fromString('100'),
      result: xdr.TransactionResultResult.txSuccess([]),
      ext: new xdr.TransactionResultExt(0),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        ledger: 42,
        successful: true,
        created_at: '2026-01-01T00:00:00Z',
        fee_charged: 100,
        result_xdr: txResult.toXDR('base64'),
      }),
    });

    const result = await service.getStatus('ok-hash');

    expect(result).toEqual({
      hash: 'ok-hash',
      status: 'success',
      ledger: 42,
      createdAt: '2026-01-01T00:00:00Z',
      feeCharged: '100',
      resultCode: 'txSuccess',
      operationResultCodes: [],
      cached: false,
    });
    expect(cache.set).toHaveBeenCalledWith(
      'stellar:tx-status:ok-hash',
      result,
      7 * 24 * 60 * 60,
    );
  });

  it('caches final failed status for 7 days', async () => {
    cache.get.mockResolvedValue(null);
    const txResult = new xdr.TransactionResult({
      feeCharged: xdr.Int64.fromString('100'),
      result: xdr.TransactionResultResult.txBadSeq(),
      ext: new xdr.TransactionResultExt(0),
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        ledger: 43,
        successful: false,
        created_at: '2026-01-01T00:00:00Z',
        fee_charged: '100',
        result_xdr: txResult.toXDR('base64'),
      }),
    });

    const result = await service.getStatus('fail-hash');

    expect(result.status).toBe('failed');
    expect(result.resultCode).toBe('txBadSeq');
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  describe('decodeResult', () => {
    it('returns nulls for missing or malformed XDR', () => {
      expect(StellarTxStatusService.decodeResult(undefined)).toEqual({
        resultCode: null,
        operationResultCodes: [],
      });
      expect(StellarTxStatusService.decodeResult('not-valid-base64-xdr')).toEqual({
        resultCode: null,
        operationResultCodes: [],
      });
    });

    it('unwraps fee-bump inner transaction results', () => {
      const innerPair = new xdr.InnerTransactionResultPair({
        transactionHash: Buffer.alloc(32, 1),
        result: new xdr.InnerTransactionResult({
          feeCharged: xdr.Int64.fromString('100'),
          result: xdr.InnerTransactionResultResult.txSuccess([]),
          ext: new xdr.InnerTransactionResultExt(0),
        }),
      });
      const feeBumpResult = new xdr.TransactionResult({
        feeCharged: xdr.Int64.fromString('200'),
        result: xdr.TransactionResultResult.txFeeBumpInnerSuccess(innerPair),
        ext: new xdr.TransactionResultExt(0),
      });

      const decoded = StellarTxStatusService.decodeResult(feeBumpResult.toXDR('base64'));

      expect(decoded).toEqual({
        resultCode: 'txFeeBumpInnerSuccess',
        operationResultCodes: [],
      });
    });
  });
});
