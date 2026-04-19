'use strict';

/**
 * Inquiry / lead capture routes
 *
 * POST /v2/inquiries — capture a buyer/seller inquiry and route it
 *
 * Stores the lead in the DB; optionally sends an email notification
 * to the listing agent and the platform admin.
 */

const { query } = require('../models/db');

module.exports = async function inquiryRoutes(fastify) {

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'message'],
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 120 },
          email:       { type: 'string', format: 'email', maxLength: 254 },
          phone:       { type: 'string', maxLength: 30 },
          message:     { type: 'string', minLength: 1, maxLength: 2000 },
          listing_id:  { type: 'string', maxLength: 20 },
          inquiry_type: {
            type: 'string',
            enum: ['showing', 'info', 'offer', 'general'],
            default: 'general',
          },
        },
      },
    },
  }, async (req, reply) => {
    const { name, email, phone, message, listing_id, inquiry_type } = req.body;

    const result = await query(
      `INSERT INTO inquiries (name, email, phone, message, listing_id, inquiry_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [name, email, phone || null, message, listing_id || null, inquiry_type || 'general']
    );

    const inquiry = result.rows[0];

    // Fire-and-forget notification (non-blocking)
    notifyAsync(inquiry.id, req.body).catch((err) => {
      fastify.log.warn({ err }, 'Inquiry notification failed');
    });

    return reply.code(201).send({
      id:         inquiry.id,
      message:    'Thank you for your inquiry. We will be in touch shortly.',
      created_at: inquiry.created_at,
    });
  });
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function notifyAsync(inquiryId, data) {
  const config = require('../config');
  if (!config.email.host || !config.email.pass) return;

  // Basic SMTP send using nodemailer (optional dependency)
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   config.email.host,
      port:   config.email.port,
      auth:   { user: config.email.user, pass: config.email.pass },
    });

    await transporter.sendMail({
      from:    config.email.from,
      to:      config.admin.email,
      subject: `New inquiry${data.listing_id ? ` on MLS# ${data.listing_id}` : ''} from ${data.name}`,
      text:    `
Name:    ${data.name}
Email:   ${data.email}
Phone:   ${data.phone || 'N/A'}
Listing: ${data.listing_id || 'N/A'}
Type:    ${data.inquiry_type}

${data.message}
      `.trim(),
    });
  } catch (err) {
    console.warn('[inquiry] Email notification failed:', err.message);
  }
}
