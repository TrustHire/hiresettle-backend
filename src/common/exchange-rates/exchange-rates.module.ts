import { Module } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';

/**
 * ExchangeRatesModule
 *
 * Provides ExchangeRateService, the cached CoinGecko-powered crypto→fiat
 * rate lookup used by reporting endpoints. CacheService is global
 * (AppCacheModule), so no extra imports are required here.
 */
@Module({
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRatesModule {}
