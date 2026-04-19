'use strict';

/**
 * Listing routes
 *
 * GET  /v2/listings              — search listings (structured + optional semantic)
 * GET  /v2/listings/:id          — single listing detail
 * GET  /v2/listings/:id/similar  — AI-powered similar listings
 * GET  /v2/listings/:id/chat     — POST: conversational listing assistant
 * GET  /v2/listings/:id/avm      — automated valuation estimate
 */

const searchService   = require('../services/search');
const avmService      = require('../services/avm');
const { chatAnswer }  = require('../services/ai');
const listingModel    = require('../models/listing');

const MAX_PAGE_SIZE = 50;

module.exports = async function listingRoutes(fastify) {

  // ── GET /v2/listings ───────────────────────────────────────────────────────
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q:               { type: 'string', maxLength: 300 },
          location:        { type: 'string', maxLength: 100 },
          minPrice:        { type: 'integer', minimum: 0 },
          maxPrice:        { type: 'integer', minimum: 0 },
          minBeds:         { type: 'integer', minimum: 0 },
          minBaths:        { type: 'integer', minimum: 0 },
          propertyType:    { type: 'string', maxLength: 50 },
          propertySubType: { type: 'string', maxLength: 80 },
          lat:             { type: 'number' },
          lng:             { type: 'number' },
          radiusMiles:     { type: 'number', minimum: 0.1, maximum: 50 },
          sort:            { type: 'string', enum: ['price-asc','price-desc','newest','relevant'] },
          page:            { type: 'integer', minimum: 1, default: 1 },
          pageSize:        { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: 12 },
        },
      },
    },
  }, async (req, reply) => {
    const { q, location, minPrice, maxPrice, minBeds, minBaths,
            propertyType, propertySubType, lat, lng, radiusMiles,
            sort, page, pageSize } = req.query;

    const result = await searchService.search({
      naturalQuery:    q,
      location,
      minPrice,
      maxPrice,
      minBeds,
      minBaths,
      propertyType,
      propertySubType,
      lat,
      lng,
      radiusMiles,
      sort,
      page,
      pageSize: Math.min(pageSize || 12, MAX_PAGE_SIZE),
    });

    return reply.send(result);
  });

  // ── GET /v2/listings/:id ───────────────────────────────────────────────────
  fastify.get('/:id', {
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
    const result = await searchService.getListing(req.params.id);
    if (!result) return reply.code(404).send({ error: 'Listing not found.' });
    return reply.send(result);
  });

  // ── GET /v2/listings/:id/similar ──────────────────────────────────────────
  fastify.get('/:id/similar', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z0-9\\-]{1,20}$' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const result = await searchService.getSimilar(req.params.id, req.query.limit || 6);
    return reply.send(result);
  });

  // ── GET /v2/listings/:id/avm ──────────────────────────────────────────────
  fastify.get('/:id/avm', {
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
    const raw = await listingModel.getListingById(req.params.id);
    if (!raw) return reply.code(404).send({ error: 'Listing not found.' });

    const valuation = await avmService.estimate(raw);
    return reply.send({ listing_id: req.params.id, ...valuation });
  });

  // ── POST /v2/listings/:id/chat ─────────────────────────────────────────────
  fastify.post('/:id/chat', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z0-9\\-]{1,20}$' },
        },
      },
      body: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', minLength: 1, maxLength: 500 },
          history: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role:    { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string', maxLength: 1000 },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id }                    = req.params;
    const { question, history = [] } = req.body;

    const result = await searchService.getListing(id);
    if (!result) return reply.code(404).send({ error: 'Listing not found.' });

    try {
      const answer = await chatAnswer(result.listing, history, question);
      return reply.send({ answer });
    } catch (err) {
      if (err.message?.includes('OPENAI_API_KEY')) {
        return reply.code(503).send({ error: 'AI assistant is not configured.' });
      }
      throw err;
    }
  });
};
