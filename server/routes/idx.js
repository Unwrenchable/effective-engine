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

// Load mock data for fallback
const path = require('path');
const fs = require('fs');
function getMockListings() {
  try {
    const seedFile = path.join(__dirname, '../../db/seed/listings.json');
    return JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  } catch (err) {
    console.warn('[idx] Could not load mock data:', err.message);
    return [];
  }
}

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

    try {
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
    } catch (err) {
      console.warn('[idx/search] Database error, falling back to mock data:', err.message);
      
      // Fallback to mock data
      const mockListings = getMockListings();
      const filtered = mockListings.filter(listing => {
        if (minPrice && listing.ListPrice < minPrice) return false;
        if (maxPrice && listing.ListPrice > maxPrice) return false;
        if (beds && listing.BedroomsTotal < beds) return false;
        if (location && !listing.City.toLowerCase().includes(location.toLowerCase())) return false;
        return true;
      });

      const start = (page - 1) * pageSize;
      const paginated = filtered.slice(start, start + pageSize);

      const listings = paginated
        .map(listing => ({
          id: listing.ListingId,
          listing_id: listing.ListingId,
          mls_status: listing.MlsStatus,
          list_price: listing.ListPrice,
          original_list_price: listing.OriginalListPrice,
          street_number: listing.StreetNumber,
          street_name: listing.StreetName,
          unit_number: listing.UnitNumber,
          city: listing.City,
          state_or_province: listing.StateOrProvince,
          postal_code: listing.PostalCode,
          latitude: listing.Latitude,
          longitude: listing.Longitude,
          bedrooms_total: listing.BedroomsTotal,
          bathrooms_total: listing.BathroomsTotalInteger,
          bathrooms_full: listing.BathroomsFull,
          bathrooms_half: listing.BathroomsHalf,
          living_area: listing.LivingArea,
          lot_size_sqft: listing.LotSizeSquareFeet,
          property_type: listing.PropertyType,
          property_sub_type: listing.PropertySubType,
          year_built: listing.YearBuilt,
          garage_spaces: listing.GarageSpaces,
          pool_yn: listing.PoolPrivateYN,
          spa_yn: listing.SpaYN,
          view_yn: listing.ViewYN,
          view_description: listing.View,
          hoa_fee: listing.AssociationFee,
          hoa_fee_frequency: listing.AssociationFeeFrequency,
          list_office_name: listing.ListOfficeName,
          list_agent_full_name: listing.ListAgentFullName,
          on_market_date: listing.OnMarketDate,
          modification_timestamp: listing.ModificationTimestamp,
          public_remarks: listing.PublicRemarks,
          ai_description: null,
          ai_photo_tags: null,
          idx_display_allowed: true,
          attribution_courtesy_of: null,
          attribution_disclaimer: null,
          photos: (listing.Media || [])
            .filter(media => media.MediaCategory === 'Photo')
            .sort((a, b) => (a.Order || 0) - (b.Order || 0))
            .map(media => ({
              url: media.MediaURL,
              order: media.Order || 0
            }))
        }))
        .map(attachDbAttribution)
        .map(applyComplianceRules)
        .filter(Boolean);

      return reply.send({ 
        total: filtered.length, 
        page, 
        pageSize, 
        listings, 
        disclaimer: DISCLAIMER,
        mock: true 
      });
    }
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

    try {
      const raw = await listingModel.getListingById(id);
      if (!raw) {
        return reply.code(404).send({ error: 'Listing not found.' });
      }

      const listing = applyComplianceRules(attachDbAttribution(raw));
      if (!listing) {
        return reply.code(404).send({ error: 'Listing not available for display.' });
      }

      return reply.send({ listing, disclaimer: DISCLAIMER });
    } catch (err) {
      console.warn('[idx/listing] Database error, checking mock data:', err.message);
      
      // Check mock data
      const mockListings = getMockListings();
      const mockListing = mockListings.find(l => l.ListingId === id);
      
      if (!mockListing) {
        return reply.code(404).send({ error: 'Listing not found.' });
      }

      const listing = applyComplianceRules(attachDbAttribution({
        id: mockListing.ListingId,
        listing_id: mockListing.ListingId,
        mls_status: mockListing.MlsStatus,
        list_price: mockListing.ListPrice,
        original_list_price: mockListing.OriginalListPrice,
        street_number: mockListing.StreetNumber,
        street_name: mockListing.StreetName,
        unit_number: mockListing.UnitNumber,
        city: mockListing.City,
        state_or_province: mockListing.StateOrProvince,
        postal_code: mockListing.PostalCode,
        latitude: mockListing.Latitude,
        longitude: mockListing.Longitude,
        bedrooms_total: mockListing.BedroomsTotal,
        bathrooms_total: mockListing.BathroomsTotalInteger,
        bathrooms_full: mockListing.BathroomsFull,
        bathrooms_half: mockListing.BathroomsHalf,
        living_area: mockListing.LivingArea,
        lot_size_sqft: mockListing.LotSizeSquareFeet,
        property_type: mockListing.PropertyType,
        property_sub_type: mockListing.PropertySubType,
        year_built: mockListing.YearBuilt,
        garage_spaces: mockListing.GarageSpaces,
        pool_yn: mockListing.PoolPrivateYN,
        spa_yn: mockListing.SpaYN,
        view_yn: mockListing.ViewYN,
        view_description: mockListing.View,
        hoa_fee: mockListing.AssociationFee,
        hoa_fee_frequency: mockListing.AssociationFeeFrequency,
        list_office_name: mockListing.ListOfficeName,
        list_agent_full_name: mockListing.ListAgentFullName,
        on_market_date: mockListing.OnMarketDate,
        modification_timestamp: mockListing.ModificationTimestamp,
        public_remarks: mockListing.PublicRemarks,
        ai_description: null,
        ai_photo_tags: null,
        idx_display_allowed: true,
        attribution_courtesy_of: null,
        attribution_disclaimer: null,
        media: (mockListing.Media || [])
          .filter(media => media.MediaCategory === 'Photo')
          .sort((a, b) => (a.Order || 0) - (b.Order || 0))
          .map(media => ({
            url: media.MediaURL,
            order: media.Order || 0,
            caption: media.ShortDescription || ''
          }))
      }));

      if (!listing) {
        return reply.code(404).send({ error: 'Listing not available for display.' });
      }

      return reply.send({ listing, disclaimer: DISCLAIMER, mock: true });
    }
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
