import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  STELLAR_NETWORK: Joi.string().valid('testnet', 'mainnet', 'futurenet').required(),
  SOROBAN_CONTRACT_ADDRESS: Joi.string().required(),
  SMTP_HOST: Joi.string().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),

  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
  NOTIFICATION_RETENTION_DAYS: Joi.number().integer().min(1).default(90),
  
  // Database connection pooling
  DATABASE_POOL_MIN: Joi.number().integer().min(1).max(20).default(2),
  DATABASE_POOL_MAX: Joi.number().integer().min(2).max(50).default(10),

  // S3 configuration
  S3_PRESIGNED_URL_EXPIRY: Joi.number().integer().min(60).max(604800).default(3600),
  S3_CLEANUP_GRACE_PERIOD_HOURS: Joi.number().integer().min(1).max(168).default(24),

  // Stellar circuit breaker
  STELLAR_BREAKER_TIMEOUT: Joi.number().integer().min(1000).max(60000).default(10000),
  STELLAR_BREAKER_ERROR_THRESHOLD: Joi.number().integer().min(1).max(100).default(50),
  STELLAR_BREAKER_RESET_TIMEOUT: Joi.number().integer().min(1000).max(300000).default(30000),
  STELLAR_BREAKER_ROLLING_COUNT_TIMEOUT: Joi.number().integer().min(1000).max(60000).default(10000),
  STELLAR_BREAKER_ROLLING_COUNT_BUCKETS: Joi.number().integer().min(1).max(20).default(10),
}).unknown(true);
