'use strict';

/**
 * Auth routes
 *
 * POST /v2/auth/login        — exchange email+password for JWT
 * POST /v2/auth/refresh      — exchange refresh token for new access token
 * POST /v2/auth/register     — create a consumer account
 * POST /v2/auth/api-keys     — issue IDX API key (admin/broker only)
 * GET  /v2/auth/me           — current user info
 */

const userModel = require('../models/user');
const config    = require('../config');

module.exports = async function authRoutes(fastify) {

  // ── Register ───────────────────────────────────────────────────────────────
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          fullName: { type: 'string', maxLength: 120 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password, fullName } = req.body;
    try {
      const user = await userModel.createUser({ email, password, fullName, role: 'consumer' });
      const token = await issueTokens(fastify, user);
      return reply.code(201).send({ ...token, user: safeUser(user) });
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'An account with this email already exists.' });
      }
      throw err;
    }
  });

  // ── Login ──────────────────────────────────────────────────────────────────
  fastify.post('/login', {
    config: {
      rateLimit: {
        max:        10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({ error: 'Too many login attempts. Please wait a minute.' }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body;
    const user = await userModel.verifyUserCredentials(email, password);

    if (!user) {
      // Constant-time response to avoid email enumeration
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }

    const token = await issueTokens(fastify, user);
    return reply.send({ ...token, user: safeUser(user) });
  });

  // ── Refresh token ──────────────────────────────────────────────────────────
  fastify.post('/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: {
          refresh_token: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    let payload;
    try {
      payload = fastify.jwt.verify(req.body.refresh_token);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired refresh token.' });
    }

    if (payload.type !== 'refresh') {
      return reply.code(401).send({ error: 'Invalid token type.' });
    }

    const user = await userModel.getUserById(payload.id);
    if (!user || !user.is_active) {
      return reply.code(401).send({ error: 'User not found or inactive.' });
    }

    const token = await issueTokens(fastify, user);
    return reply.send({ ...token, user: safeUser(user) });
  });

  // ── Current user ───────────────────────────────────────────────────────────
  fastify.get('/me', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    const user = await userModel.getUserById(req.user.id);
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    return reply.send({ user: safeUser(user) });
  });

  // ── Issue API key ──────────────────────────────────────────────────────────
  fastify.post('/api-keys', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          label:  { type: 'string', maxLength: 100 },
          scopes: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        },
      },
    },
  }, async (req, reply) => {
    if (!['admin', 'broker'].includes(req.user.role)) {
      return reply.code(403).send({ error: 'API key issuance requires admin or broker role.' });
    }

    const { label = '', scopes = ['idx:read'] } = req.body || {};
    const { key, id } = await userModel.createApiKey(req.user.id, label, scopes);

    return reply.code(201).send({
      id,
      key,
      label,
      scopes,
      note: 'Store this key securely — it will not be shown again.',
    });
  });
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function issueTokens(fastify, user) {
  const payload = { id: user.id, email: user.email, role: user.role };
  const access_token  = fastify.jwt.sign(payload, { expiresIn: config.jwt.expiresIn });
  const refresh_token = fastify.jwt.sign(
    { id: user.id, type: 'refresh' },
    { expiresIn: config.jwt.refreshExpiresIn }
  );
  return { access_token, refresh_token, token_type: 'Bearer' };
}

function safeUser(user) {
  const { password_hash: _, ...safe } = user;
  return safe;
}
