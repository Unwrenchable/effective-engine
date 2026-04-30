'use strict';

/**
 * Engine harness route.
 *
 * POST /api/engine
 * body: { messages: [{ role, content }] }
 */

const { runEngine } = require('../services/engine');
const config = require('../config');

module.exports = async function engineRoutes(fastify) {
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            minItems: 1,
            maxItems: Math.max(1, config.engine.maxMessages),
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                content: { type: 'string', minLength: 1, maxLength: Math.max(1, config.engine.maxCharsPerMessage) },
              },
              required: ['content'],
            },
          },
        },
        required: ['messages'],
      },
    },
  }, async (req, reply) => {
    try {
      const result = await runEngine({ messages: req.body.messages || [] });
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err, 'Engine error');
      return reply.code(500).send({ error: err?.message || 'Engine failed. Check server logs.' });
    }
  });
};
