'use strict';

/**
 * Market stats routes
 *
 * GET /v2/market/stats            — aggregate stats for a city/zip/type
 * GET /v2/neighborhoods/:slug     — neighbourhood profile + AI narrative
 */

const marketService = require('../services/market');

module.exports = async function marketRoutes(fastify) {

  fastify.get('/stats', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          city:          { type: 'string', maxLength: 100 },
          postalCode:    { type: 'string', maxLength: 10 },
          propertyType:  { type: 'string', maxLength: 50 },
          minPrice:      { type: 'integer', minimum: 0 },
          maxPrice:      { type: 'integer', minimum: 0 },
          minLotAcres:   { type: 'number', minimum: 0 },
          lookbackDays:  { type: 'integer', minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
  }, async (req, reply) => {
    const { city, postalCode, propertyType, minPrice, maxPrice, minLotAcres, lookbackDays } = req.query;
    const stats = await marketService.getStats({
      city,
      postalCode,
      propertyType,
      minPrice,
      maxPrice,
      minLotAcres,
      lookbackDays,
    });
    return reply.send(stats);
  });
};
