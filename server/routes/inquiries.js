'use strict';

/**
 * Inquiry / lead capture routes
 *
 * POST /v2/inquiries — capture a buyer/seller inquiry and route it
 *
 * Stores the lead in the DB, seeds the message thread with the first
 * inbound message, verifies Cloudflare Turnstile CAPTCHA (when configured),
 * and sends an email notification to the admin — all without exposing
 * Donna's email address anywhere in the frontend HTML.
 */

const { query } = require('../models/db');
const config    = require('../config');

// Turnstile verification endpoint
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

module.exports = async function inquiryRoutes(fastify) {

  fastify.post('/', {
    config: {
      rateLimit: {
        max:        5,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          error: 'Too many submissions. Please wait a moment before trying again.',
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'message'],
        properties: {
          name:               { type: 'string', minLength: 1, maxLength: 120 },
          email:              { type: 'string', format: 'email', maxLength: 254 },
          phone:              { type: 'string', maxLength: 30 },
          message:            { type: 'string', minLength: 1, maxLength: 2000 },
          listing_id:         { type: 'string', maxLength: 20 },
          inquiry_type: {
            type: 'string',
            enum: ['showing', 'info', 'offer', 'general'],
            default: 'general',
          },
          // Which site the form was submitted from
          lead_source: {
            type: 'string',
            enum: ['main_site', 'horse_site'],
            default: 'main_site',
          },
          // Visitor opted in to new-listing update emails
          subscribe_to_updates: { type: 'boolean', default: false },
          // Cloudflare Turnstile challenge token (required when TURNSTILE_SECRET_KEY is set)
          cf_turnstile_token: { type: 'string', maxLength: 2048 },
        },
      },
    },
  }, async (req, reply) => {
    const {
      name, email, phone, message,
      listing_id, inquiry_type,
      lead_source, subscribe_to_updates,
      cf_turnstile_token,
    } = req.body;

    // ── Turnstile CAPTCHA verification ──────────────────────────────────────
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

    // ── Insert inquiry ───────────────────────────────────────────────────────
    const result = await query(
      `INSERT INTO inquiries
         (name, email, phone, message, listing_id, inquiry_type, lead_source, subscribe_to_updates)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        name,
        email,
        phone              || null,
        message,
        listing_id         || null,
        inquiry_type       || 'general',
        lead_source        || 'main_site',
        subscribe_to_updates === true,
      ]
    );

    const inquiry = result.rows[0];

    // ── Seed the message thread with the first inbound message ───────────────
    await query(
      `INSERT INTO inquiry_messages (inquiry_id, direction, body)
       VALUES ($1, 'inbound', $2)`,
      [inquiry.id, message]
    );

    // Fire-and-forget notification (non-blocking).
    // NOTE: Only non-sensitive identifiers are passed; email and message body
    //       are never logged or included in notification payloads.
    notifyAsync(inquiry.id, { name, phone, listing_id, inquiry_type, lead_source }).catch((err) => {
      fastify.log.warn({ err }, 'Inquiry notification failed');
    });

    return reply.code(201).send({
      id:         inquiry.id,
      message:    'Thank you for your inquiry. We will be in touch shortly.',
      created_at: inquiry.created_at,
    });
  });
};

// ─── Turnstile verification ───────────────────────────────────────────────────

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
    console.warn('[inquiry] Turnstile verification error:', err.message);
    // Fail closed on errors — a Turnstile outage should not silently bypass CAPTCHA.
    // If Turnstile is unavailable for maintenance, disable TURNSTILE_SECRET_KEY temporarily.
    return false;
  }
}

// ─── Email notification ───────────────────────────────────────────────────────

async function notifyAsync(inquiryId, data) {
  if (!config.email.host) return;

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   config.email.host,
      port:   config.email.port,
      secure: config.email.port === 465,
      ...(config.email.user && config.email.pass
        ? { auth: { user: config.email.user, pass: config.email.pass } }
        : {}),
    });

    const source = data.lead_source === 'horse_site' ? 'Horse Properties site' : 'Main site';

    await transporter.sendMail({
      from:    config.email.from,
      // Admin email set in .env (ADMIN_EMAIL) — never hard-coded in HTML
      to:      config.admin.email,
      subject: `New lead (#${inquiryId})${data.listing_id ? ` — MLS# ${data.listing_id}` : ''} [${source}]`,
      text: [
        `Lead #${inquiryId} — ${source}`,
        `Name:    ${data.name || 'N/A'}`,
        `Type:    ${data.inquiry_type}`,
        `Phone:   ${data.phone || 'N/A'}`,
        `Listing: ${data.listing_id || 'N/A'}`,
        '',
        `View full conversation in the admin panel:`,
        `  /admin/`,
      ].join('\n'),
    });
  } catch (err) {
    console.warn('[inquiry] Email notification failed:', err.message);
  }
}

