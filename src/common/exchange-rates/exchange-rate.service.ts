import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CacheService } from '../cache/cache.service';

/**
 * CoinGecko coin IDs for the tokens HireSettle allows on-chain. CoinGecko's
 * `/simple/price` endpoint accepts these ids; unknown symbols simply yield
 * no rate (fiat fields are omitted rather than erroring).
 */
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  USDC: 'usd-coin',
  USDT: 'tether',
  XLM: 'stellar',
  XRP: 'ripple',
  ETH: 'ethereum',
  BTC: 'bitcoin',
  DAI: 'dai',
  BUSD: 'binance-usd',
  EURC: 'euro-coin',
};

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const DEFAULT_TTL_S = 300; // 5 minutes — rate data is not volatile enough to hit the provider harder

/**
 * ExchangeRateService
 *
 * Fetches crypto → fiat exchange rates from CoinGecko's public
 * `/simple/price` endpoint and caches them cache-aside (key prefix `fx:`)
 * so the provider is only consulted once per (token, currency) per TTL —
 * avoiding rate-limit throttling on the free tier.
 *
 * A rate lookup NEVER throws: unknown symbols, unsupported currencies, or
 * provider failures all return `null` so reporting endpoints can degrade
 * gracefully.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Get the price of `tokenSymbol` in `fiat` (e.g. getRate('USDC', 'USD')).
   * Returns null when the token/currency is unsupported or the provider
   * cannot be reached.
   */
  async getRate(tokenSymbol: string, fiat: string): Promise<number | null> {
    const symbol = tokenSymbol?.trim().toUpperCase();
    const currency = fiat?.trim().toUpperCase();

    if (!symbol || !currency || !this.isSupportedCurrency(currency)) {
      return null;
    }

    const cacheKey = `fx:${symbol.toLowerCase()}:${currency.toLowerCase()}`;
    const cached = await this.cache?.get<number>(cacheKey);
    if (cached != null) return cached;

    const coinId = SYMBOL_TO_COINGECKO_ID[symbol];
    if (!coinId) return null;

    try {
      const rate = await this.fetchRate(coinId, currency);
      if (rate != null) {
        const ttl = this.config.get<number>('EXCHANGE_RATE_TTL_S', DEFAULT_TTL_S);
        await this.cache?.set(cacheKey, rate, ttl);
      }
      return rate;
    } catch (error: any) {
      this.logger.error(
        `Exchange rate lookup failed for ${symbol}/${currency}`,
        error?.message ?? String(error),
      );
      return null;
    }
  }

  private async fetchRate(coinId: string, fiat: string): Promise<number | null> {
    const apiKey = this.config.get<string>('COINGECKO_API_KEY');
    const params: Record<string, string> = {
      ids: coinId,
      vs_currencies: fiat.toLowerCase(),
    };
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) {
      // Demo/free keys are passed via this header; the public keyless
      // endpoint is used when no key is configured.
      headers['x-cg-demo-api-key'] = apiKey;
    }

    const response = await axios.get(`${COINGECKO_BASE_URL}/simple/price`, {
      params,
      headers,
      timeout: 10_000,
    });

    const value = response.data?.[coinId]?.[fiat.toLowerCase()];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private isSupportedCurrency(currency: string): boolean {
    // ISO 4217 style alpha-3 code (e.g. USD, EUR, JPY, GBP).
    return /^[A-Z]{3}$/.test(currency);
  }
}
