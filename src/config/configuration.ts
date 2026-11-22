export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    horizonUrl: process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  },
  sanctions: {
    // Sanctions screening provider (or periodically imported list) used to
    // screen Stellar addresses before funding and before release.
    providerUrl: process.env.SANCTIONS_PROVIDER_URL,
    apiKey: process.env.SANCTIONS_API_KEY,
    // How long a screening result is cached before it is re-checked.
    cacheTtlSeconds: parseInt(process.env.SANCTIONS_CACHE_TTL_SECONDS ?? '3600', 10),
    // Fail closed: when the provider is unavailable, block release and alert.
    failClosed: (process.env.SANCTIONS_FAIL_CLOSED ?? 'true') === 'true',
  },
});
