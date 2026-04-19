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

const DISCLAIMER = 'Information deemed reliable but not guaranteed. ' +
  'Listing data © Greater Las Vegas Association of REALTORS® (GLVAR). ' +
  'IDX information is provided exclusively for consumers\' personal, ' +
  'non-commercial use and may not be used for any purpose other than to ' +
  'identify prospective properties consumers may be interested in purchasing.';

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

  const { listings: raw, total } = await listingModel.searchListings({
    ...structuredOpts,
    embedding,
  });

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
  const raw = await listingModel.getListingById(listingId);
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
  const raw      = await listingModel.getSimilarListings(listingId, limit);
  const listings = raw
    .map(attachDbAttribution)
    .map(applyComplianceRules)
    .filter(Boolean);

  return { listings, disclaimer: DISCLAIMER };
}

module.exports = { search, getListing, getSimilar, DISCLAIMER };
