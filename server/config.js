'use strict';

/**
 * Centralised environment variable loading and validation.
 * All server code imports from here — never process.env directly.
 */

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Required environment variable ${name} is not set.`);
  return val;
}

function optional(name, defaultValue = '') {
  return process.env[name] || defaultValue;
}

function optionalInt(name, defaultValue) {
  const val = process.env[name];
  if (!val) return defaultValue;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be an integer.`);
  return n;
}

function optionalBool(name, defaultValue = false) {
  const val = process.env[name];
  if (val === undefined || val === '') return defaultValue;
  return val === 'true' || val === '1';
}

const config = {
  server: {
    port:   optionalInt('PORT', 3001),
    host:   optional('HOST', '0.0.0.0'),
    origin: optional('SITE_ORIGIN', 'https://www.donnasellslv.com'),
  },

  db: {
    url:    optional('DATABASE_URL'),
    host:   optional('DB_HOST', 'localhost'),
    port:   optionalInt('DB_PORT', 5432),
    name:   optional('DB_NAME', 'donnasellslv'),
    user:   optional('DB_USER', 'postgres'),
    pass:   optional('DB_PASSWORD'),
    ssl:    optionalBool('DB_SSL'),
  },

  // Legacy Spark API (IDX proxy fallback)
  spark: {
    baseUrl:      optional('IDX_BASE_URL', 'https://api.sparkapi.com'),
    clientId:     optional('IDX_CLIENT_ID'),
    clientSecret: optional('IDX_CLIENT_SECRET'),
    apiKey:       optional('IDX_API_KEY'),
  },

  // RESO Web API (direct MLS feed)
  reso: {
    baseUrl:      optional('RESO_BASE_URL', 'https://replication.sparkapi.com/Reso/OData'),
    clientId:     optional('RESO_CLIENT_ID'),
    clientSecret: optional('RESO_CLIENT_SECRET'),
    apiKey:       optional('RESO_API_KEY'),
  },

  openai: {
    apiKey:         optional('OPENAI_API_KEY'),
    embeddingModel: optional('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
    chatModel:      optional('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
  },

  jwt: {
    secret:            optional('JWT_SECRET', 'CHANGE_ME_IN_PRODUCTION_minimum_64_chars_xxxxxxx'),
    expiresIn:         optional('JWT_EXPIRES_IN', '8h'),
    refreshExpiresIn:  optional('REFRESH_TOKEN_EXPIRES_IN', '30d'),
  },

  cdn: {
    provider:   optional('CDN_PROVIDER', 'r2'),
    publicUrl:  optional('R2_PUBLIC_URL', optional('S3_PUBLIC_URL')),
    r2: {
      accountId:  optional('R2_ACCOUNT_ID'),
      accessKey:  optional('R2_ACCESS_KEY_ID'),
      secretKey:  optional('R2_SECRET_ACCESS_KEY'),
      bucket:     optional('R2_BUCKET', 'donnasellslv-media'),
    },
    s3: {
      accessKey:  optional('AWS_ACCESS_KEY_ID'),
      secretKey:  optional('AWS_SECRET_ACCESS_KEY'),
      region:     optional('AWS_REGION', 'us-west-2'),
      bucket:     optional('S3_BUCKET', 'donnasellslv-media'),
    },
  },

  sync: {
    intervalMinutes: optionalInt('SYNC_INTERVAL_MINUTES', 15),
    fullSyncHour:    optionalInt('SYNC_FULL_HOUR', 3),
    batchSize:       optionalInt('SYNC_BATCH_SIZE', 200),
  },

  email: {
    host:     optional('SMTP_HOST'),
    port:     optionalInt('SMTP_PORT', 587),
    user:     optional('SMTP_USER'),
    pass:     optional('SMTP_PASS'),
    from:     optional('EMAIL_FROM', 'alerts@donnasellslv.com'),
  },

  admin: {
    email:           optional('ADMIN_EMAIL', 'admin@donnasellslv.com'),
    initialPassword: optional('ADMIN_INITIAL_PASSWORD', 'change_me_immediately'),
  },
};

module.exports = config;
