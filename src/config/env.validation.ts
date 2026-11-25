import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  // Asymmetric JWT signing + rotation (#481). JSON array of
  // { kid, privateKey?, publicKey? } PEM entries (or a file with the same JSON).
  JWT_SIGNING_KEYS: Joi.string().allow('').optional(),
  JWT_SIGNING_KEYS_FILE: Joi.string().allow('').optional(),
  JWT_ACTIVE_KID: Joi.string().allow('').optional(),
  JWT_ACCEPT_LEGACY_HS256: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(false),
  STELLAR_NETWORK: Joi.string().valid('testnet', 'mainnet', 'futurenet').required(),
  SOROBAN_CONTRACT_ADDRESS: Joi.string().required(),
  HIRESETTLE_CONTRACT_VERSION: Joi.string().default('1'),
  SKIP_CONTRACT_COMPATIBILITY_CHECK: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(false),
  SMTP_HOST: Joi.string().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),

  PORT: Joi.number().port().default(3000),
  CORS_ALLOWED_HEADERS: Joi.string()
    .default(
      'Content-Type, Authorization, Idempotency-Key, X-API-Key, If-None-Match, X-Request-Id',
    )
    .allow(''),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
  NOTIFICATION_RETENTION_DAYS: Joi.number().integer().min(1).default(90),

  // Idle session expiration — refresh tokens unused for longer than this
  // window are rejected on POST /auth/refresh (defaults to 7 days).
  IDLE_SESSION_WINDOW_DAYS: Joi.number().integer().min(1).max(365).default(7),

  // Password complexity policy
  PASSWORD_MIN_LENGTH: Joi.number().integer().min(6).max(128).default(8),
  PASSWORD_REQUIRE_UPPERCASE: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(true),
  PASSWORD_REQUIRE_LOWERCASE: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(true),
  PASSWORD_REQUIRE_NUMBER: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(true),
  PASSWORD_REQUIRE_SPECIAL: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(false),

  // HaveIBeenPwned breach-password check
  // Set to 'false' to disable (e.g. in offline environments or CI without outbound HTTPS).
  HIBP_CHECK_ENABLED: Joi.string().valid('true', 'false', '1', '0').default('true'),

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

  // Placement milestone due-soon reminder (#260)
  PLACEMENT_MILESTONE_REMINDER_DAYS: Joi.number().integer().min(1).max(365).default(7),

  // Dispute workflow (#381, #382)
  DISPUTE_APPEAL_WINDOW_HOURS: Joi.number().integer().min(0).max(720).default(72),
  DISPUTE_SLA_ASSIGNMENT_HOURS: Joi.number().integer().min(1).max(720).default(24),
  DISPUTE_SLA_REVIEW_HOURS: Joi.number().integer().min(1).max(720).default(72),
  DISPUTE_SLA_APPEAL_HOURS: Joi.number().integer().min(1).max(720).default(72),

  // Database connection pooling
  DATABASE_POOL_MIN: Joi.number().integer().min(1).max(20).default(2),
  DATABASE_POOL_MAX: Joi.number().integer().min(2).max(50).default(10),

  // S3 configuration
  S3_PRESIGNED_URL_EXPIRY: Joi.number().integer().min(60).max(604800).default(3600),
  S3_CLEANUP_GRACE_PERIOD_HOURS: Joi.number().integer().min(1).max(168).default(24),

  // Malware scanning of uploaded evidence (#471) — clamd TCP endpoint
  CLAMAV_HOST: Joi.string().default('localhost'),
  CLAMAV_PORT: Joi.number().integer().min(1).max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: Joi.number().integer().min(1000).max(300000).default(30000),

  // Stellar circuit breaker
  STELLAR_BREAKER_TIMEOUT: Joi.number().integer().min(1000).max(60000).default(10000),
  STELLAR_BREAKER_ERROR_THRESHOLD: Joi.number().integer().min(1).max(100).default(50),
  STELLAR_BREAKER_RESET_TIMEOUT: Joi.number().integer().min(1000).max(300000).default(30000),
  STELLAR_BREAKER_ROLLING_COUNT_TIMEOUT: Joi.number().integer().min(1000).max(60000).default(10000),
  STELLAR_BREAKER_ROLLING_COUNT_BUCKETS: Joi.number().integer().min(1).max(20).default(10),

  // Horizon failover
  HORIZON_URLS: Joi.string().allow('').optional(),
  HORIZON_FAILOVER_THRESHOLD: Joi.number().integer().min(1).max(20).default(3),
  HORIZON_RECOVERY_INTERVAL_MS: Joi.number().integer().min(5000).default(60000),

  // Web push / VAPID (optional, #392) — push is disabled when keys are unset.
  // Generate a key pair with: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: Joi.string().allow('').optional(),
  VAPID_PRIVATE_KEY: Joi.string().allow('').optional(),
  VAPID_SUBJECT: Joi.string().pattern(/^(mailto:|https:\/\/)/).allow('').optional(),

  // Google OAuth2 (optional)
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().allow('').optional(),
  GOOGLE_OAUTH_SUCCESS_REDIRECT: Joi.string().uri().allow('').optional(),

  // Dev endpoints (Friendbot, etc.) — defaults to false on production / mainnet (#442).
  // The application also force-disables dev endpoints when NODE_ENV=production or
  // STELLAR_NETWORK=mainnet, regardless of this value.
  ENABLE_DEV_ENDPOINTS: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(false),

  // SEP-24 fiat off-ramp anchors: JSON array of
  // [{ "id": "moneygram", "name": "MoneyGram", "homeDomain": "stellar.moneygram.com", "assets": ["USDC"] }]
  PAYOUT_ANCHORS: Joi.string().allow('').default('[]'),
  PAYOUT_POLL_MAX_AGE_HOURS: Joi.number().integer().min(1).default(168),

  // Claimable-balance fallback for recruiters without a trustline
  CLAIMABLE_BALANCE_RECLAIM_DAYS: Joi.number().integer().min(1).default(90),
  CLAIMABLE_BALANCE_REMINDER_DAYS: Joi.number().integer().min(1).default(3),
  CLAIMABLE_BALANCE_MAX_REMINDERS: Joi.number().integer().min(0).default(5),

  // Daily audit-chain root anchoring on Stellar (optional)
  // Optional HMAC key for the audit chain; without it hashes are plain SHA-256
  AUDIT_CHAIN_HMAC_KEY: Joi.string().min(32).allow('').optional(),

  // Ceilings for API-key limits that key owners may set themselves (admins are not capped)
  API_KEY_OWNER_MAX_RATE_LIMIT: Joi.number().integer().min(1).optional(),
  API_KEY_OWNER_MAX_MONTHLY_QUOTA: Joi.number().integer().min(1).default(100000),

  AUDIT_CHAIN_ANCHOR_ENABLED: Joi.boolean().truthy('true', '1', 'yes').falsy('false', '0', 'no').default(false),
}).unknown(true);
