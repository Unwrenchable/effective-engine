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

  // RESO Web API (direct MLS feed — set RESO_BASE_URL to go live)
  // GLVAR uses the Spark Platform (flexmls).  Credentials at:
  //   https://www.sparkplatform.com/register
  // Then request GLVAR MLS access via your GLVAR membership.
  reso: {
    baseUrl:      optional('RESO_BASE_URL',   'https://replication.sparkapi.com/Reso/OData'),
    // Spark Platform OAuth2 token endpoint (separate from the RESO data endpoint)
    tokenUrl:     optional('RESO_TOKEN_URL',  'https://sparkplatform.com/openid/oauth2/token'),
    clientId:     optional('RESO_CLIENT_ID'),
    clientSecret: optional('RESO_CLIENT_SECRET'),
    apiKey:       optional('RESO_API_KEY'),
    // Set RESO_MOCK=true in development to use db/seed/listings.json instead of a live feed
    mock:         optionalBool('RESO_MOCK', false),
  },

  // AI provider: 'ollama' (default, self-hosted) or 'openai' (cloud fallback)
  ai: {
    provider:           optional('AI_PROVIDER', 'ollama'),
    // Ollama — runs locally or on the same VPS (https://ollama.com)
    ollamaBaseUrl:      optional('OLLAMA_BASE_URL', 'http://localhost:11434'),
    ollamaEmbedModel:   optional('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),  // 768-dim
    ollamaChatModel:    optional('OLLAMA_CHAT_MODEL', 'llama3.2'),
    ollamaVisionModel:  optional('OLLAMA_VISION_MODEL', 'llava'),
    // OpenAI — used when AI_PROVIDER=openai or as fallback when Ollama is unavailable
    openaiApiKey:       optional('OPENAI_API_KEY'),
    openaiEmbedModel:   optional('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
    openaiChatModel:    optional('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
  },

  jwt: {
    secret:            optional('JWT_SECRET', 'CHANGE_ME_IN_PRODUCTION_minimum_64_chars_xxxxxxx'),
    expiresIn:         optional('JWT_EXPIRES_IN', '8h'),
    refreshExpiresIn:  optional('REFRESH_TOKEN_EXPIRES_IN', '30d'),
  },

  // Media / CDN: 'local' (default), 'minio', 'r2', 's3'
  cdn: {
    provider:   optional('CDN_PROVIDER', 'local'),
    // Local disk — photos saved to <localPath> and served at <localPublicUrl>
    localPath:      optional('MEDIA_LOCAL_PATH', 'public/media'),
    localPublicUrl: optional('MEDIA_PUBLIC_URL', '/media'),
    // MinIO (self-hosted S3-compatible — set endpoint to http://localhost:9000)
    minio: {
      endpoint:   optional('MINIO_ENDPOINT', 'http://localhost:9000'),
      accessKey:  optional('MINIO_ACCESS_KEY'),
      secretKey:  optional('MINIO_SECRET_KEY'),
      bucket:     optional('MINIO_BUCKET', 'donnasellslv-media'),
      publicUrl:  optional('MINIO_PUBLIC_URL'),
    },
    // Cloudflare R2
    r2: {
      accountId:  optional('R2_ACCOUNT_ID'),
      accessKey:  optional('R2_ACCESS_KEY_ID'),
      secretKey:  optional('R2_SECRET_ACCESS_KEY'),
      bucket:     optional('R2_BUCKET', 'donnasellslv-media'),
      publicUrl:  optional('R2_PUBLIC_URL'),
    },
    // AWS S3
    s3: {
      accessKey:  optional('AWS_ACCESS_KEY_ID'),
      secretKey:  optional('AWS_SECRET_ACCESS_KEY'),
      region:     optional('AWS_REGION', 'us-west-2'),
      bucket:     optional('S3_BUCKET', 'donnasellslv-media'),
      publicUrl:  optional('S3_PUBLIC_URL'),
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
    email:           optional('ADMIN_EMAIL', 'Donna@donnasellslv.com'),
    initialPassword: optional('ADMIN_INITIAL_PASSWORD', 'change_me_immediately'),
  },

  // Cloudflare Turnstile (human verification on contact forms)
  // Get keys at: https://dash.cloudflare.com → Turnstile
  // Leave blank to skip CAPTCHA verification (development only).
  turnstile: {
    secretKey: optional('TURNSTILE_SECRET_KEY'),
    siteKey:   optional('TURNSTILE_SITE_KEY'),
  },

  // Redis caching for performance
  redis: {
    enabled: optionalBool('REDIS_ENABLED', false),
    host: optional('REDIS_HOST', 'localhost'),
    port: optionalInt('REDIS_PORT', 6379),
    password: optional('REDIS_PASSWORD'),
    db: optionalInt('REDIS_DB', 0),
  },
};

module.exports = config;
