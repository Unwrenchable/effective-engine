'use strict';

/**
 * Platform API server entry point.
 *
 * Registers Fastify plugins and mounts all route modules.
 * Run with: node server/index.js
 *
 * Endpoints:
 *   GET  /health
 *   POST /v2/auth/login
 *   POST /v2/auth/register
 *   GET  /v2/auth/me
 *   POST /v2/auth/api-keys
 *   GET  /v2/listings
 *   GET  /v2/listings/:id
 *   GET  /v2/listings/:id/similar
 *   GET  /v2/listings/:id/avm
 *   POST /v2/listings/:id/chat
 *   GET  /v2/market/stats
 *   GET  /v2/neighborhoods
 *   GET  /v2/neighborhoods/:slug
 *   POST /v2/alerts
 *   GET  /v2/alerts
 *   DELETE /v2/alerts/:id
 *   GET  /v2/agents/:mlsId
 *   GET  /v2/agents/:mlsId/listings
 *   POST /v2/inquiries
 *   POST /v2/admin/sync          (admin only)
 *   GET  /v2/admin/sync/status   (admin only)
 *   GET  /v2/admin/reso/verify   (admin only)
 */

const Fastify      = require('fastify');
const cors         = require('@fastify/cors');
const jwt          = require('@fastify/jwt');
const rateLimit    = require('@fastify/rate-limit');
const config       = require('./config');

async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { translateTime: true, ignore: 'pid,hostname' } }
        : undefined,
    },
    trustProxy: true,
    // Ajv options — strict schemas
    ajv: {
      customOptions: { removeAdditional: 'all', coerceTypes: true, useDefaults: true },
    },
  });

  // ── Plugins ────────────────────────────────────────────────────────────────

  await fastify.register(cors, {
    origin:      config.server.origin,
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await fastify.register(rateLimit, {
    max:      100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'Too many requests. Please slow down.' }),
  });

  await fastify.register(jwt, {
    secret: config.jwt.secret,
  });

  // Decorate with `authenticate` — use in routes via onRequest: [fastify.authenticate]
  fastify.decorate('authenticate', async function (req, reply) {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Authentication required.' });
    }
  });

  // ── Health check ───────────────────────────────────────────────────────────

  fastify.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── Routes ─────────────────────────────────────────────────────────────────

  fastify.register(require('./routes/auth'),          { prefix: '/v2/auth' });
  fastify.register(require('./routes/listings'),       { prefix: '/v2/listings' });
  fastify.register(require('./routes/market'),         { prefix: '/v2/market' });
  fastify.register(require('./routes/neighborhoods'),  { prefix: '/v2/neighborhoods' });
  fastify.register(require('./routes/alerts'),         { prefix: '/v2/alerts' });
  fastify.register(require('./routes/agents'),         { prefix: '/v2/agents' });
  fastify.register(require('./routes/inquiries'),      { prefix: '/v2/inquiries' });
  fastify.register(require('./routes/admin/sync'),     { prefix: '/v2/admin' });

  // ── Error handler ──────────────────────────────────────────────────────────

  fastify.setErrorHandler((err, req, reply) => {
    fastify.log.error(err);

    if (err.validation) {
      return reply.code(400).send({ error: 'Validation error.', details: err.validation });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: err.message });
    }

    const code = err.statusCode || 500;
    const msg  = code < 500 ? err.message : 'An unexpected error occurred.';
    return reply.code(code).send({ error: msg });
  });

  return fastify;
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(`[server] Listening on ${config.server.host}:${config.server.port}`);

    // Start the MLS sync scheduler
    try {
      const { startScheduler } = require('./sync/scheduler');
      await startScheduler();
    } catch (err) {
      console.warn('[server] Scheduler not started:', err.message);
      console.warn('[server] Run "node server/sync/ingest.js --once" manually to sync listings.');
    }
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { buildApp };
