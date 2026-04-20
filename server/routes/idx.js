'use strict';

/**
 * IDX routes — Fastify plugin replacing the former Vercel serverless api/idx/ functions.
 *
 * Routes (mounted at /api/idx by server/index.js):
 *   GET /api/idx/search          — search active listings
 *   GET /api/idx/listing/:id     — full listing detail by MLS#
 *   GET /api/idx/verify          — test RESO / mock connection
 *
 * Data source: the local PostgreSQL database populated by the RESO sync pipeline.
 * No Spark API or Vercel serverless functions required.
 *
 * URL paths are identical to the former Vercel functions so the frontend
 * fetch() calls need no changes.
 */

const listingModel = require('../models/listing');
const { applyComplianceRules, applyComplianceToList, attachDbAttribution } = require('../services/compliance');
const { verifyConnection } = require('../sync/reso-client');

const DISCLAIMER = 'Information deemed reliable but not guaranteed. ' +
  'Listing data © Greater Las Vegas Association of REALTORS® (GLVAR). ' +
  'IDX information is provided exclusively for consumers\' personal, ' +
  'non-commercial use and may not be used for any purpose other than to ' +
  'identify prospective properties consumers may be interested in purchasing.';

const SAFE_ID_RE = /^[a-zA-Z0-9\-]{1,20}$/;

// Map frontend homeType slugs → DB property_type / property_sub_type
const HOME_TYPE_MAP = {
  'single-family':    { propertyType: 'Residential', propertySubType: null },
  'penthouse':        { propertyType: 'Residential', propertySubType: 'High Rise' },
  'condo':            { propertyType: 'Residential', propertySubType: 'Condominium' },
  'estate':           { propertyType: 'Residential', propertySubType: null },
  'new-construction': { propertyType: 'Residential', propertySubType: 'New Construction' },
  'guard-gated':      { propertyType: 'Residential', propertySubType: null },
  'horse-property':   { propertyType: 'Residential', propertySubType: null },
};

module.exports = async function idxRoutes(fastify) {

  // ── GET /api/idx/search ───────────────────────────────────────────────────
  fastify.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          location:  { type: 'string', maxLength: 100 },
          minPrice:  { type: 'integer', minimum: 0 },
          maxPrice:  { type: 'integer', minimum: 0 },
          beds:      { type: 'integer', minimum: 0 },
          homeType:  { type: 'string', maxLength: 30 },
          page:      { type: 'integer', minimum: 1, default: 1 },
          pageSize:  { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          sort:      { type: 'string', enum: ['price-asc', 'price-desc', 'newest'], default: 'newest' },
        },
      },
    },
  }, async (req, reply) => {
    const { location, minPrice, maxPrice, beds, homeType, page, pageSize, sort } = req.query;

    const typeFilter = HOME_TYPE_MAP[homeType];

    const { listings: raw, total } = await listingModel.searchListings({
      location,
      minPrice,
      maxPrice,
      minBeds:         beds,
      propertyType:    typeFilter?.propertyType,
      propertySubType: typeFilter?.propertySubType,
      sort,
      page,
      pageSize,
    });

    const listings = raw
      .map(attachDbAttribution)
      .map(applyComplianceRules)
      .filter(Boolean);

    return reply.send({ total, page, pageSize, listings, disclaimer: DISCLAIMER });
  });

  // ── GET /api/idx/listing/:id ──────────────────────────────────────────────
  fastify.get('/listing/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z0-9\\-]{1,20}$' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;

    if (!SAFE_ID_RE.test(id)) {
      return reply.code(400).send({ error: 'Invalid listing ID.' });
    }

    const raw = await listingModel.getListingById(id);
    if (!raw) {
      return reply.code(404).send({ error: 'Listing not found.' });
    }

    const listing = applyComplianceRules(attachDbAttribution(raw));
    if (!listing) {
      return reply.code(404).send({ error: 'Listing not available for display.' });
    }

    return reply.send({ listing, disclaimer: DISCLAIMER });
  });

  // ── GET /api/idx/verify ───────────────────────────────────────────────────
  fastify.get('/verify', {
    config: {
      rateLimit: {
        max:        10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({ connected: false, error: 'Rate limit exceeded.' }),
      },
    },
  }, async (_req, reply) => {
    try {
      const result = await verifyConnection();
      return reply.send(result);
    } catch (err) {
      return reply.code(503).send({ connected: false, error: err.message });
    }
  });
};
