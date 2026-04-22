'use strict';

/**
 * Admin lead-management routes (protected: admin role required)
 *
 * GET    /v2/admin/leads              — list leads with filters + pagination
 * GET    /v2/admin/leads/:id          — single lead with full message thread
 * PATCH  /v2/admin/leads/:id          — update status / notes / assigned_to
 * POST   /v2/admin/leads/:id/messages — add an outbound reply/note to the thread
 */

const { query } = require('../../models/db');

module.exports = async function adminLeadsRoutes(fastify) {

  // Auth + admin-only guard (mirrors admin/sync.js pattern)
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('preHandler', async (req, reply) => {
    if (req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin access required.' });
    }
  });

  // ── GET /v2/admin/leads ─────────────────────────────────────────────────────
  fastify.get('/leads', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status:      { type: 'string', enum: ['new', 'contacted', 'qualified', 'closed'] },
          lead_source: { type: 'string', enum: ['main_site', 'horse_site'] },
          page:        { type: 'integer', minimum: 1, default: 1 },
          pageSize:    { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
  }, async (req, reply) => {
    const { status, lead_source, page, pageSize } = req.query;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params     = [];

    if (status) {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (lead_source) {
      params.push(lead_source);
      conditions.push(`i.lead_source = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const countRes = await query(
      `SELECT COUNT(*) AS total FROM inquiries i ${where}`,
      params
    );

    // Paginated rows — include latest message preview
    params.push(pageSize, offset);
    const rows = await query(
      `SELECT
         i.id, i.name, i.email, i.phone,
         i.inquiry_type, i.lead_source, i.status,
         i.listing_id, i.subscribe_to_updates,
         i.created_at, i.updated_at,
         u.full_name  AS assigned_to_name,
         -- most recent message snippet (first 120 chars)
         LEFT(
           (SELECT body FROM inquiry_messages
            WHERE inquiry_id = i.id
            ORDER BY created_at DESC LIMIT 1),
           120
         ) AS last_message
       FROM inquiries i
       LEFT JOIN users u ON u.id = i.assigned_to
       ${where}
       ORDER BY i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return reply.send({
      leads:    rows.rows,
      total:    parseInt(countRes.rows[0].total, 10),
      page,
      pageSize,
    });
  });

  // ── GET /v2/admin/leads/:id ─────────────────────────────────────────────────
  fastify.get('/leads/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params;

    const leadRes = await query(
      `SELECT
         i.*,
         u.full_name   AS assigned_to_name,
         cb.full_name  AS status_changed_by_name
       FROM inquiries i
       LEFT JOIN users u  ON u.id  = i.assigned_to
       LEFT JOIN users cb ON cb.id = i.status_changed_by
       WHERE i.id = $1`,
      [id]
    );

    if (!leadRes.rows.length) {
      return reply.code(404).send({ error: 'Lead not found.' });
    }

    const messagesRes = await query(
      `SELECT
         m.id, m.direction, m.body, m.created_at,
         u.full_name AS author_name
       FROM inquiry_messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.inquiry_id = $1
       ORDER BY m.created_at ASC`,
      [id]
    );

    return reply.send({
      lead:     leadRes.rows[0],
      messages: messagesRes.rows,
    });
  });

  // ── PATCH /v2/admin/leads/:id ───────────────────────────────────────────────
  fastify.patch('/leads/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          status:      { type: 'string', enum: ['new', 'contacted', 'qualified', 'closed'] },
          notes:       { type: 'string', maxLength: 4000 },
          assigned_to: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const { id }                    = req.params;
    const { status, notes, assigned_to } = req.body || {};

    // Build SET clause dynamically from provided fields
    const sets   = ['updated_at = NOW()'];
    const params = [];

    if (status !== undefined) {
      params.push(status);
      sets.push(`status = $${params.length}`);
      // Audit: record who changed the status and when
      params.push(req.user.id);
      sets.push(`status_changed_at = NOW(), status_changed_by = $${params.length}`);
    }
    if (notes !== undefined) {
      params.push(notes);
      sets.push(`notes = $${params.length}`);
    }
    if (assigned_to !== undefined) {
      params.push(assigned_to);
      sets.push(`assigned_to = $${params.length}`);
    }

    if (sets.length === 1) {
      // Only updated_at — nothing real to update
      return reply.code(400).send({ error: 'No updatable fields provided.' });
    }

    params.push(id);
    const result = await query(
      `UPDATE inquiries SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, status, notes, assigned_to, updated_at, status_changed_at`,
      params
    );

    if (!result.rows.length) {
      return reply.code(404).send({ error: 'Lead not found.' });
    }

    return reply.send({ lead: result.rows[0] });
  });

  // ── POST /v2/admin/leads/:id/messages ───────────────────────────────────────
  fastify.post('/leads/:id/messages', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
    },
  }, async (req, reply) => {
    const { id }   = req.params;
    const { body } = req.body;

    // Verify lead exists
    const check = await query(`SELECT id FROM inquiries WHERE id = $1`, [id]);
    if (!check.rows.length) {
      return reply.code(404).send({ error: 'Lead not found.' });
    }

    const result = await query(
      `INSERT INTO inquiry_messages (inquiry_id, direction, body, author_id)
       VALUES ($1, 'outbound', $2, $3)
       RETURNING id, direction, body, created_at`,
      [id, body, req.user.id]
    );

    // Bump the inquiry's updated_at so it bubbles to the top of the list
    await query(`UPDATE inquiries SET updated_at = NOW() WHERE id = $1`, [id]);

    return reply.code(201).send({ message: result.rows[0] });
  });
};
