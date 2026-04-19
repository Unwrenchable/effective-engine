'use strict';

/**
 * Neighbourhood routes
 *
 * GET /v2/neighborhoods/:slug — neighbourhood profile: market stats + AI narrative
 *
 * Slugs are kebab-case names:
 *   summerlin, henderson, green-valley, anthem, southern-highlands,
 *   centennial-hills, boulder-city, skye-canyon, aliante, north-las-vegas, etc.
 */

const marketService = require('../services/market');

const KNOWN_SLUGS = new Set([
  'summerlin', 'henderson', 'green-valley', 'anthem', 'southern-highlands',
  'centennial-hills', 'boulder-city', 'skye-canyon', 'aliante',
  'north-las-vegas', 'enterprise', 'spring-valley', 'the-lakes',
  'desert-shores', 'macdonald-ranch', 'seven-hills', 'mountains-edge',
  'inspirada', 'cadence', 'lake-las-vegas', 'paradise', 'whitney-ranch',
]);

module.exports = async function neighborhoodRoutes(fastify) {

  fastify.get('/:slug', {
    schema: {
      params: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9-]{1,60}$' },
        },
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params;

    if (!KNOWN_SLUGS.has(slug)) {
      return reply.code(404).send({ error: 'Neighbourhood not found.' });
    }

    try {
      const profile = await marketService.getNeighbourhoodProfile(slug);
      return reply.send(profile);
    } catch (err) {
      fastify.log.error(err, 'Neighbourhood profile error');
      throw err;
    }
  });

  // List all known neighbourhoods
  fastify.get('/', async (_req, reply) => {
    return reply.send({
      neighborhoods: Array.from(KNOWN_SLUGS).sort().map((slug) => ({
        slug,
        displayName: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    });
  });
};
