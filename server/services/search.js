'use strict';

/**
 * Listing search orchestration service.
 *
 * Combines structured DB queries with optional semantic (vector) search.
 * Applies IDX compliance rules before returning results.
 */

const listingModel  = require('../models/listing');
const { generateEmbedding, buildListingText } = require('./ai');
const { applyComplianceToList, applyComplianceRules, attachDbAttribution } = require('./compliance');
const fs = require('fs');
const path = require('path');

const DISCLAIMER = 'Information deemed reliable but not guaranteed. ' +
  'Listing data © Greater Las Vegas Association of REALTORS® (GLVAR). ' +
  'IDX information is provided exclusively for consumers\' personal, ' +
  'non-commercial use and may not be used for any purpose other than to ' +
  'identify prospective properties consumers may be interested in purchasing.';

let cachedMockListings = null;

function loadMockListings() {
  if (cachedMockListings) return cachedMockListings;
  const seedFile = path.join(__dirname, '../../db/seed/listings.json');
  const data = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  cachedMockListings = Array.isArray(data) ? data : [];
  return cachedMockListings;
}

function normalizeMockListing(listing) {
  return {
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
      .filter((media) => media.MediaCategory === 'Photo')
      .sort((a, b) => (a.Order || 0) - (b.Order || 0))
      .map((media) => ({
        url: media.MediaURL,
        order: media.Order || 0,
        caption: media.ShortDescription || '',
      })),
  };
}

function fallbackSearch(structuredOpts = {}) {
  const {
    location,
    minPrice,
    maxPrice,
    minBeds,
    minBaths,
    propertyType,
    propertySubType,
    page = 1,
    pageSize = 12,
    sort = 'newest',
  } = structuredOpts;

  const filtered = loadMockListings().filter((listing) => {
    if (minPrice && Number(listing.ListPrice || 0) < minPrice) return false;
    if (maxPrice && Number(listing.ListPrice || 0) > maxPrice) return false;
    if (minBeds && Number(listing.BedroomsTotal || 0) < minBeds) return false;
    if (minBaths && Number(listing.BathroomsTotalInteger || 0) < minBaths) return false;
    if (propertyType && String(listing.PropertyType || '') !== propertyType) return false;
    if (propertySubType && String(listing.PropertySubType || '') !== propertySubType) return false;
    if (location) {
      const locationText = String(location).toLowerCase();
      const city = String(listing.City || '').toLowerCase();
      const postal = String(listing.PostalCode || '').toLowerCase();
      const remarks = String(listing.PublicRemarks || '').toLowerCase();
      if (!city.includes(locationText) && !postal.includes(locationText) && !remarks.includes(locationText)) {
        return false;
      }
    }
    return true;
  });

  if (sort === 'price-asc') filtered.sort((a, b) => (a.ListPrice || 0) - (b.ListPrice || 0));
  if (sort === 'price-desc') filtered.sort((a, b) => (b.ListPrice || 0) - (a.ListPrice || 0));
  if (sort === 'newest') filtered.sort((a, b) => String(b.ModificationTimestamp || '').localeCompare(String(a.ModificationTimestamp || '')));

  const offset = (page - 1) * pageSize;
  const listings = filtered.slice(offset, offset + pageSize).map(normalizeMockListing);
  return { listings, total: filtered.length };
}

// ─── Structured + semantic search ────────────────────────────────────────────

/**
 * Search listings.  If naturalQuery is provided and OpenAI is configured,
 * generates an embedding and ranks results by semantic similarity.
 *
 * @param {object} opts
 * @param {string}  [opts.naturalQuery]  free-text query (triggers semantic search)
 * @param {string}  [opts.location]
 * @param {number}  [opts.minPrice]
 * @param {number}  [opts.maxPrice]
 * @param {number}  [opts.minBeds]
 * @param {number}  [opts.minBaths]
 * @param {string}  [opts.propertyType]
 * @param {string}  [opts.propertySubType]
 * @param {number}  [opts.lat]
 * @param {number}  [opts.lng]
 * @param {number}  [opts.radiusMiles]
 * @param {string}  [opts.sort]
 * @param {number}  [opts.page]
 * @param {number}  [opts.pageSize]
 * @returns {Promise<{listings:object[], total:number, disclaimer:string, semantic:boolean}>}
 */
async function search(opts = {}) {
  const { naturalQuery, ...structuredOpts } = opts;

  let embedding = null;
  let semantic  = false;

  if (naturalQuery) {
    try {
      embedding = await generateEmbedding(naturalQuery);
      semantic  = true;
      if (!structuredOpts.sort) structuredOpts.sort = 'relevant';
    } catch (err) {
      console.warn('[search] Semantic search unavailable, falling back to structured:', err.message);
    }
  }

  let raw;
  let total;
  try {
    ({ listings: raw, total } = await listingModel.searchListings({
      ...structuredOpts,
      embedding,
    }));
  } catch (err) {
    console.warn('[search] DB unavailable, using seeded fallback listings:', err.message);
    ({ listings: raw, total } = fallbackSearch(structuredOpts));
  }

  const listings = raw
    .map(attachDbAttribution)
    .map(applyComplianceRules)
    .filter(Boolean);

  return { listings, total, disclaimer: DISCLAIMER, semantic };
}

// ─── Single listing ───────────────────────────────────────────────────────────

/**
 * Fetch a single listing by MLS ID and apply compliance.
 * @param {string} listingId
 * @returns {Promise<{listing:object, disclaimer:string}|null>}
 */
async function getListing(listingId) {
  let raw;
  try {
    raw = await listingModel.getListingById(listingId);
  } catch (err) {
    console.warn('[search/getListing] DB unavailable, using seeded fallback listings:', err.message);
    const match = loadMockListings().find((listing) => String(listing.ListingId) === String(listingId));
    raw = match ? normalizeMockListing(match) : null;
  }
  if (!raw) return null;

  const listing = applyComplianceRules(attachDbAttribution(raw));
  if (!listing) return null;

  return { listing, disclaimer: DISCLAIMER };
}

// ─── Similar listings ─────────────────────────────────────────────────────────

/**
 * Get listings similar to the given one.
 * @param {string} listingId
 * @param {number} [limit]
 * @returns {Promise<{listings:object[], disclaimer:string}>}
 */
async function getSimilar(listingId, limit = 6) {
  let raw;
  try {
    raw = await listingModel.getSimilarListings(listingId, limit);
  } catch (err) {
    console.warn('[search/getSimilar] DB unavailable, using seeded fallback listings:', err.message);
    const base = loadMockListings().find((listing) => String(listing.ListingId) === String(listingId));
    if (!base) raw = [];
    else {
      raw = loadMockListings()
        .filter((listing) => String(listing.ListingId) !== String(listingId))
        .sort((a, b) => {
          const cityScoreA = String(a.City || '') === String(base.City || '') ? -1 : 0;
          const cityScoreB = String(b.City || '') === String(base.City || '') ? -1 : 0;
          if (cityScoreA !== cityScoreB) return cityScoreA - cityScoreB;
          return Math.abs((a.ListPrice || 0) - (base.ListPrice || 0))
            - Math.abs((b.ListPrice || 0) - (base.ListPrice || 0));
        })
        .slice(0, limit)
        .map(normalizeMockListing);
    }
  }
  const listings = raw
    .map(attachDbAttribution)
    .map(applyComplianceRules)
    .filter(Boolean);

  return { listings, disclaimer: DISCLAIMER };
}

module.exports = { search, getListing, getSimilar, DISCLAIMER };
