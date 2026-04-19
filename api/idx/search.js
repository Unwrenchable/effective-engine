/**
 * GET /api/idx/search
 *
 * Proxies property-search queries to the MLS/IDX provider and returns
 * compliance-filtered listing results.
 *
 * Query parameters (all optional):
 *   location   – community or city name (e.g. "Summerlin")
 *   minPrice   – minimum list price in USD (integer)
 *   maxPrice   – maximum list price in USD (integer)
 *   beds       – minimum bedroom count (integer)
 *   homeType   – one of: single-family | penthouse | condo | estate |
 *                        new-construction | guard-gated
 *   page       – 1-based page number (default 1)
 *   pageSize   – results per page, 1–50 (default 12)
 *   sort       – one of: price-asc | price-desc | newest (default newest)
 *
 * Response 200:
 *   {
 *     total:    <number>,
 *     page:     <number>,
 *     pageSize: <number>,
 *     listings: [ ...compliance-filtered listing objects ],
 *     disclaimer: "<GLVAR IDX disclaimer text>"
 *   }
 */

'use strict';

const { idxGet, IdxConfigError, IdxAuthError, IdxApiError } = require('./_lib/client');
const { applyComplianceToList, buildAttribution }           = require('./_lib/compliance');

const CORS_ORIGIN = process.env.SITE_ORIGIN || 'https://www.donnasellslv.com';

// Allowed values for the sort parameter
const SORT_MAP = {
  'price-asc':  'ListPrice',
  'price-desc': '-ListPrice',
  'newest':     '-ModificationTimestamp',
};

// Map of friendly home-type slugs to Spark API PropertyType values
const HOME_TYPE_MAP = {
  'single-family':    'Residential',
  'penthouse':        'ResidentialIncome',
  'condo':            'Residential',
  'estate':           'Residential',
  'new-construction': 'Residential',
  'guard-gated':      'Residential',
};

// Map friendly slugs to an additional SubType filter when needed
const SUBTYPE_MAP = {
  'penthouse':        'High Rise',
  'condo':            'Condominium',
  'guard-gated':      'Guard Gated',
  'new-construction': 'New Construction',
};

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 12;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  setCorsHeaders(res, CORS_ORIGIN);

  // ── Parse + validate query params ────────────────────────────────────────
  const q = req.query || {};

  const location = sanitizeText(q.location);
  const minPrice = parsePositiveInt(q.minPrice);
  const maxPrice = parsePositiveInt(q.maxPrice);
  const beds     = parsePositiveInt(q.beds);
  const homeType = HOME_TYPE_MAP[q.homeType] ? q.homeType : null;
  const page     = Math.max(1, parsePositiveInt(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parsePositiveInt(q.pageSize) || DEFAULT_PAGE_SIZE));
  const sortKey  = SORT_MAP[q.sort] ? q.sort : 'newest';

  // ── Build Spark API filter expression ────────────────────────────────────
  const filters = ['MlsStatus Eq \'Active\''];

  if (location) filters.push(`City Eq '${escapeSpark(location)}'`);
  if (minPrice) filters.push(`ListPrice Ge ${minPrice}`);
  if (maxPrice) filters.push(`ListPrice Le ${maxPrice}`);
  if (beds)     filters.push(`BedroomsTotal Ge ${beds}`);

  if (homeType) {
    filters.push(`PropertyType Eq '${HOME_TYPE_MAP[homeType]}'`);
    if (SUBTYPE_MAP[homeType]) {
      filters.push(`PropertySubType Eq '${SUBTYPE_MAP[homeType]}'`);
    }
  }

  const sparkParams = {
    _filter:   filters.join(' And '),
    _orderby:  SORT_MAP[sortKey],
    _limit:    String(pageSize),
    _offset:   String((page - 1) * pageSize),
    _expand:   'Photos',
    _select:   [
      'ListingId', 'MlsStatus', 'ListPrice', 'StreetNumber', 'StreetName',
      'City', 'StateOrProvince', 'PostalCode', 'BedroomsTotal',
      'BathroomsTotalInteger', 'LivingArea', 'LotSizeSquareFeet',
      'PropertyType', 'PropertySubType', 'ListOfficeName',
      'ListAgentFullName', 'ModificationTimestamp', 'Photos',
      'PublicRemarks', 'YearBuilt', 'GarageSpaces', 'IDXDisplayAllowed',
    ].join(','),
  };

  try {
    const data = await idxGet('/v1/listings', sparkParams);

    // Spark API wraps results in D.Results
    const rawListings = data?.D?.Results ?? data?.Results ?? data ?? [];
    const total       = data?.D?.TotalCount ?? data?.TotalCount ?? rawListings.length;

    const listings = applyComplianceToList(rawListings);

    const disclaimer = listings.length > 0
      ? listings[0]._attribution?.mlsDisclaimer
      : buildAttribution({}).mlsDisclaimer;

    return res.status(200).json({ total, page, pageSize, listings, disclaimer });
  } catch (err) {
    const { status, body } = classifyError(err);
    return res.status(status).json(body);
  }
};

// ─── helpers ────────────────────────────────────────────────────────────────

function setCorsHeaders(res, origin) {
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=60');
}

/** Remove characters that could break a Spark filter string. */
function escapeSpark(value) {
  return value.replace(/'/g, "''");
}

/** Allow letters, digits, spaces, commas, hyphens, apostrophes, and dots. */
function sanitizeText(value) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^a-zA-Z0-9\s,\-'.]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > 0 && clean.length <= 100 ? clean : null;
}

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classifyError(err) {
  if (err instanceof IdxConfigError) {
    console.error('[idx/search] Config error:', err.message);
    return { status: 503, body: { error: 'IDX gateway not configured.' } };
  }
  if (err instanceof IdxAuthError) {
    console.error('[idx/search] Auth error:', err.message);
    return { status: 503, body: { error: 'MLS authentication failed.' } };
  }
  if (err instanceof IdxApiError) {
    console.error('[idx/search] API error:', err.message);
    return { status: err.status >= 500 ? 502 : 503, body: { error: 'MLS provider error. Try again shortly.' } };
  }
  if (err && err.name === 'AbortError') {
    return { status: 504, body: { error: 'MLS provider timed out.' } };
  }
  console.error('[idx/search] Unexpected error:', err);
  return { status: 500, body: { error: 'An unexpected error occurred.' } };
}
