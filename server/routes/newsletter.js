'use strict';

/**
 * Newsletter subscription routes (public)
 *
 * POST /v2/newsletter/subscribe    — opt-in a visitor's email
 * GET  /v2/newsletter/unsubscribe  — one-click unsubscribe via token link
 *
 * Handles Cloudflare Turnstile CAPTCHA (when configured), rate-limits
 * each IP, and generates a unique unsubscribe token so we can include a
 * one-click unsubscribe link in every email blast.
 */

const { query }  = require('../models/db');
const config     = require('../config');

// Re-use the same Turnstile endpoint that inquiries.js uses
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

module.exports = async function newsletterRoutes(fastify) {

  // ── POST /v2/newsletter/subscribe ─────────────────────────────────────────
  fastify.post('/subscribe', {
    config: {
      rateLimit: {
        max:        5,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          error: 'Too many subscription attempts. Please wait a moment before trying again.',
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email:  { type: 'string', format: 'email', maxLength: 254 },
          source: {
            type:    'string',
            enum:    ['main_site', 'horse_site'],
            default: 'horse_site',
          },
          // Cloudflare Turnstile challenge token (required when TURNSTILE_SECRET_KEY is set)
          cf_turnstile_token: { type: 'string', maxLength: 2048 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, source, cf_turnstile_token } = req.body;

    // ── Turnstile CAPTCHA verification ────────────────────────────────────────
    if (config.turnstile.secretKey) {
      const tokenProvided = typeof cf_turnstile_token === 'string' && cf_turnstile_token.length > 0;
      if (!tokenProvided) {
        return reply.code(400).send({ error: 'Human verification required.' });
      }

      const verified = await verifyTurnstile(
        cf_turnstile_token,
        req.headers['cf-connecting-ip'] || req.ip,
      );

      if (!verified) {
        return reply.code(400).send({ error: 'Human verification failed. Please try again.' });
      }
    }

    // ── Upsert subscriber ─────────────────────────────────────────────────────
    // If the email + source combo already exists and was unsubscribed, re-subscribe it.
    // If it never existed, insert a fresh row with a new token.
    const result = await query(
      `INSERT INTO newsletter_subscribers (email, source)
       VALUES ($1, $2)
       ON CONFLICT (email, source) DO UPDATE
         SET unsubscribed_at = NULL,
             subscribed_at   = CASE
               WHEN newsletter_subscribers.unsubscribed_at IS NOT NULL THEN NOW()
               ELSE newsletter_subscribers.subscribed_at
             END
       RETURNING id, unsubscribe_token, subscribed_at`,
      [email.toLowerCase().trim(), source]
    );

    const subscriber = result.rows[0];

    return reply.code(201).send({
      id:         subscriber.id,
      message:    'You\'re subscribed! Look out for horse property updates from Donna.',
      subscribed_at: subscriber.subscribed_at,
    });
  });

  // ── GET /v2/newsletter/unsubscribe?token=<token> ───────────────────────────
  fastify.get('/unsubscribe', {
    config: {
      rateLimit: {
        max:        10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          error: 'Too many unsubscribe attempts. Please wait a moment before trying again.',
        }),
      },
    },
    schema: {
      querystring: {
        type:       'object',
        required:   ['token'],
        properties: {
          token: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const { token } = req.query;

    const result = await query(
      `UPDATE newsletter_subscribers
       SET unsubscribed_at = NOW()
       WHERE unsubscribe_token = $1 AND unsubscribed_at IS NULL
       RETURNING id, email, source`,
      [token]
    );

    if (!result.rows.length) {
      // Either invalid token or already unsubscribed — treat both as success
      // to avoid leaking subscription status.
      return reply.send({ message: 'You have been unsubscribed.' });
    }

    return reply.send({ message: 'You have been successfully unsubscribed.' });
  });
};

// ─── Turnstile verification (same logic as inquiries.js) ─────────────────────

async function verifyTurnstile(token, remoteIp) {
  try {
    const body = new URLSearchParams({
      secret:   config.turnstile.secretKey,
      response: token,
      remoteip: remoteIp || '',
    });

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
      signal:  AbortSignal.timeout(8_000),
    });

    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.warn('[newsletter] Turnstile verification error:', err.message);
    return false;
  }
}
