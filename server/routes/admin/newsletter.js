'use strict';

/**
 * Admin newsletter-subscriber management routes (admin role required)
 *
 * GET    /v2/admin/newsletter              — list subscribers with filters + pagination
 * DELETE /v2/admin/newsletter/:id          — hard-delete a subscriber record
 */

const { query } = require('../../models/db');

module.exports = async function adminNewsletterRoutes(fastify) {

  // Auth + admin-only guard
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('preHandler', async (req, reply) => {
    if (req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin access required.' });
    }
  });

  // ── GET /v2/admin/newsletter ────────────────────────────────────────────────
  fastify.get('/newsletter', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          source:   { type: 'string', enum: ['main_site', 'horse_site'] },
          // active = not unsubscribed; unsubscribed = opted out; omit for all
          status:   { type: 'string', enum: ['active', 'unsubscribed'] },
          page:     { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
  }, async (req, reply) => {
    const { source, status, page, pageSize } = req.query;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params     = [];

    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }
    if (status === 'active') {
      conditions.push('unsubscribed_at IS NULL');
    } else if (status === 'unsubscribed') {
      conditions.push('unsubscribed_at IS NOT NULL');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM newsletter_subscribers ${where}`,
      params
    );

    params.push(pageSize, offset);
    const rows = await query(
      `SELECT id, email, source, subscribed_at, unsubscribed_at
       FROM newsletter_subscribers
       ${where}
       ORDER BY subscribed_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return reply.send({
      subscribers: rows.rows,
      total:       parseInt(countRes.rows[0].total, 10),
      page,
      pageSize,
    });
  });

  // ── DELETE /v2/admin/newsletter/:id ────────────────────────────────────────
  fastify.delete('/newsletter/:id', {
    schema: {
      params: {
        type:       'object',
        properties: { id: { type: 'integer' } },
        required:   ['id'],
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;

    const result = await query(
      `DELETE FROM newsletter_subscribers WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      return reply.code(404).send({ error: 'Subscriber not found.' });
    }

    return reply.send({ deleted: true });
  });
};
