'use strict';

/**
 * Saved search / buyer alert routes
 *
 * POST /v2/alerts       — create a saved search (auth required)
 * GET  /v2/alerts       — list current user's alerts
 * DELETE /v2/alerts/:id — remove an alert
 */

const alertModel = require('../models/alert');

module.exports = async function alertRoutes(fastify) {

  fastify.addHook('onRequest', fastify.authenticate);

  // ── Create ─────────────────────────────────────────────────────────────────
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'criteria'],
        properties: {
          name:      { type: 'string', minLength: 1, maxLength: 100 },
          email:     { type: 'string', format: 'email', maxLength: 254 },
          frequency: { type: 'string', enum: ['instant', 'daily', 'weekly'], default: 'instant' },
          criteria: {
            type: 'object',
            properties: {
              location:        { type: 'string', maxLength: 100 },
              minPrice:        { type: 'integer', minimum: 0 },
              maxPrice:        { type: 'integer', minimum: 0 },
              minBeds:         { type: 'integer', minimum: 0 },
              minBaths:        { type: 'integer', minimum: 0 },
              propertyType:    { type: 'string', maxLength: 50 },
              propertySubType: { type: 'string', maxLength: 80 },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { name, email, frequency, criteria } = req.body;

    const alert = await alertModel.createAlert({
      userId:    req.user.id,
      name,
      email:     email || req.user.email,
      criteria,
      frequency,
    });

    return reply.code(201).send(alert);
  });

  // ── List ───────────────────────────────────────────────────────────────────
  fastify.get('/', async (req, reply) => {
    const alerts = await alertModel.getAlertsByUser(req.user.id);
    return reply.send({ alerts });
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { query } = require('../models/db');
    await query(
      `UPDATE saved_searches SET is_active = false
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    return reply.code(204).send();
  });
};
