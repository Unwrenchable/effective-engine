'use strict';

/**
 * Agent routes
 *
 * GET /v2/agents/:mlsId/listings — active listings for an agent
 * GET /v2/agents/:mlsId          — agent profile
 */

const agentModel = require('../models/agent');

module.exports = async function agentRoutes(fastify) {

  fastify.get('/:mlsId', {
    schema: {
      params: {
        type: 'object',
        required: ['mlsId'],
        properties: {
          mlsId: { type: 'string', pattern: '^[a-zA-Z0-9]{1,30}$' },
        },
      },
    },
  }, async (req, reply) => {
    const profile = await agentModel.getAgentProfile(req.params.mlsId);
    if (!profile) return reply.code(404).send({ error: 'Agent not found.' });
    return reply.send({ agent: profile });
  });

  fastify.get('/:mlsId/listings', {
    schema: {
      params: {
        type: 'object',
        required: ['mlsId'],
        properties: {
          mlsId: { type: 'string', pattern: '^[a-zA-Z0-9]{1,30}$' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const listings = await agentModel.getAgentListings(req.params.mlsId, req.query.limit || 20);
    return reply.send({
      listings,
      count: listings.length,
      disclaimer: 'Information deemed reliable but not guaranteed. Listing data © GLVAR.',
    });
  });
};
