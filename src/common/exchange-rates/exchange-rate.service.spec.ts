import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CacheService } from '../cache/cache.service';
import { ExchangeRateService } from './exchange-rate.service';

jest.mock('axios');
const mockAxiosGet = axios.get as jest.Mock;

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  let cache: CacheService;

  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    flush: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'EXCHANGE_RATE_TTL_S') return 300;
      return undefined; // COINGECKO_API_KEY unset
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAxiosGet.mockResolvedValue({ data: { 'usd-coin': { usd: 1.0 } } });
    service = new ExchangeRateService(
      mockConfig as unknown as ConfigService,
      mockCache as unknown as CacheService,
    );
    cache = mockCache as unknown as CacheService;
  });

  it('returns a cached rate without calling the provider', async () => {
    mockCache.get.mockResolvedValue(1.0);

    const rate = await service.getRate('USDC', 'USD');

    expect(rate).toBe(1.0);
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('fetches from the provider on a cache miss and caches the result', async () => {
    mockCache.get.mockResolvedValue(null);

    const rate = await service.getRate('USDC', 'USD');

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/simple/price',
      expect.objectContaining({
        params: { ids: 'usd-coin', vs_currencies: 'usd' },
      }),
    );
    expect(rate).toBe(1.0);
    expect(mockCache.set).toHaveBeenCalledWith('fx:usdc:usd', 1.0, 300);
  });

  it('is case-insensitive for symbol and currency', async () => {
    mockCache.get.mockResolvedValue(null);

    const rate = await service.getRate('usdc', 'usd');

    expect(rate).toBe(1.0);
    expect(mockCache.set).toHaveBeenCalledWith('fx:usdc:usd', 1.0, 300);
  });

  it('returns null for an unsupported token symbol without calling the provider', async () => {
    mockCache.get.mockResolvedValue(null);

    const rate = await service.getRate('SOMECOIN', 'USD');

    expect(rate).toBeNull();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('returns null for an invalid currency code', async () => {
    mockCache.get.mockResolvedValue(null);

    const rate = await service.getRate('USDC', 'USDOLLAR');

    expect(rate).toBeNull();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('returns null when the provider fails instead of throwing', async () => {
    mockCache.get.mockResolvedValue(null);
    mockAxiosGet.mockRejectedValue(new Error('rate limited'));

    const rate = await service.getRate('USDC', 'USD');

    expect(rate).toBeNull();
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('sends the demo API key header when configured', async () => {
    mockCache.get.mockResolvedValue(null);
    (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'EXCHANGE_RATE_TTL_S') return 300;
      if (key === 'COINGECKO_API_KEY') return 'demo-key';
      return undefined;
    });

    await service.getRate('USDC', 'USD');

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/simple/price',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-cg-demo-api-key': 'demo-key' }),
      }),
    );
  });
});
