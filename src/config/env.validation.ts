import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  STELLAR_NETWORK: Joi.string().valid('testnet', 'mainnet', 'futurenet').required(),
  SOROBAN_CONTRACT_ADDRESS: Joi.string().required(),
  HIRESETTLE_CONTRACT_VERSION: Joi.string().default('1'),
  SKIP_CONTRACT_COMPATIBILITY_CHECK: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(false),
  SMTP_HOST: Joi.string().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),

  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
  NOTIFICATION_RETENTION_DAYS: Joi.number().integer().min(1).default(90),

  // Data retention windows — per category (set to -1 to disable a category)
  DATA_RETENTION_DAYS: Joi.number().integer().min(-1).default(365),
  PII_ANONYMIZATION_WINDOW_DAYS: Joi.number().integer().min(1).default(30),
  RETENTION_NOTIFICATIONS_DAYS: Joi.number().integer().min(-1).default(90),
  RETENTION_NOTIFICATIONS_UNREAD_DAYS: Joi.number().integer().min(-1).default(365),
  RETENTION_SECURITY_EVENTS_DAYS: Joi.number().integer().min(-1).default(365),
  RETENTION_IDEMPOTENCY_KEYS_DAYS: Joi.number().integer().min(-1).default(0),
  RETENTION_REFRESH_TOKENS_DAYS: Joi.number().integer().min(-1).default(30),
  RETENTION_DATA_DELETION_REQS_DAYS: Joi.number().integer().min(-1).default(365),

  // Stellar backend account balance alert
  STELLAR_BALANCE_ALERT_INTERVAL_MS: Joi.number().integer().min(60000).default(300000),
  STELLAR_BALANCE_ALERT_THRESHOLD_STROOPS: Joi.number().integer().min(0).default(10000000),
  
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

  // Google OAuth2 (optional)
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().allow('').optional(),
  GOOGLE_OAUTH_SUCCESS_REDIRECT: Joi.string().uri().allow('').optional(),
}).unknown(true);
