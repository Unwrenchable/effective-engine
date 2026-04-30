'use strict';

/**
 * RESO Web API (OData 4.0) client — GLVAR / Spark Platform edition.
 *
 * GLVAR (Greater Las Vegas Association of REALTORS®) delivers MLS data
 * through the Spark Platform (flexmls).  The data endpoint and token
 * endpoint are on different hostnames:
 *
 *   RESO data endpoint:   https://replication.sparkapi.com/Reso/OData
 *   OAuth2 token endpoint: https://sparkplatform.com/openid/token
 *
 * How to get live credentials:
 *   1. Register a Spark Platform developer account:
 *        https://www.sparkplatform.com/register
 *   2. Create an application in the Spark Developer Portal to receive
 *        RESO_CLIENT_ID and RESO_CLIENT_SECRET.
 *   3. Request GLVAR MLS data access through your GLVAR membership.
 *        (login at https://lasvegasrealtor.com → MLS Resources → Data Access)
 *   4. Set RESO_MOCK=false and fill RESO_CLIENT_ID / RESO_CLIENT_SECRET in .env.
 *
 * Standard RESO Web API resource paths:
 *   GET /Property               — listings
 *   GET /Member                 — agents
 *   GET /Office                 — offices
 *   GET /Media                  — listing photos
 *   GET /OpenHouse              — open houses
 *
 * Reference: https://www.reso.org/reso-web-api/
 */

const config = require('../config');
const path   = require('path');

// In-process OAuth2 token cache
let _tokenCache = null; // { access_token, expires_at }

const RESO_HTTP_TIMEOUT_MS = 30_000;
const RESO_HTTP_MAX_RETRIES = 2;
const RESO_AUTH_MAX_RETRIES = 1;

// ─── Mock mode ────────────────────────────────────────────────────────────────

/**
 * When RESO_MOCK=true, return seed data from db/seed/listings.json instead of
 * making any live API calls.  Useful for development without a live MLS license.
 */
function getMockListings() {
  const seedFile = path.join(__dirname, '../../db/seed/listings.json');
  try {
    return JSON.parse(require('fs').readFileSync(seedFile, 'utf8'));
  } catch (err) {
    console.warn('[reso-client] RESO_MOCK=true but could not read db/seed/listings.json:', err.message);
    return [];
  }
}

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Obtain a valid Bearer token for the RESO feed.
 * Uses RESO_API_KEY when set; otherwise performs OAuth2 Client Credentials.
 * @returns {Promise<string>}
 */
async function getBearerToken() {
  const { apiKey, clientId, clientSecret, baseUrl } = config.reso;

  if (apiKey) return apiKey;

  if (!clientId || !clientSecret) {
    throw new ResoConfigError(
      'RESO credentials not configured. Set RESO_CLIENT_ID and RESO_CLIENT_SECRET ' +
      '(or RESO_API_KEY) as environment variables.\n' +
      'Register at https://www.sparkplatform.com/register to obtain Spark/GLVAR credentials.'
    );
  }

  const now       = Date.now();
  const bufferMs  = 60_000;
  if (_tokenCache && _tokenCache.expires_at > now + bufferMs) {
    return _tokenCache.access_token;
  }

  // Use the explicit RESO_TOKEN_URL (defaults to Spark Platform OAuth2 endpoint).
  // NOTE: For Spark/GLVAR the token URL is sparkplatform.com/openid/token —
  //       it is NOT derived from the RESO data endpoint hostname.
  const tokenUrl = config.reso.tokenUrl;
  const body     = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
  });

  for (let attempt = 1; attempt <= RESO_AUTH_MAX_RETRIES + 1; attempt++) {
    try {
      const res = await fetchWithTimeout(tokenUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
      }, RESO_HTTP_TIMEOUT_MS, `TOKEN attempt=${attempt}`);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ResoAuthError(`RESO token request failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      if (!data.access_token) {
        throw new ResoAuthError('RESO token response missing access_token field.');
      }

      _tokenCache = {
        access_token: data.access_token,
        expires_at:   now + (data.expires_in || 3600) * 1000,
      };

      return _tokenCache.access_token;
    } catch (err) {
      if (attempt > RESO_AUTH_MAX_RETRIES || !isRetryableNetworkError(err)) {
        throw err;
      }
      await backoff(attempt);
    }
  }

  throw new ResoAuthError('RESO token acquisition failed after retries.');
}

// ─── Core OData request ───────────────────────────────────────────────────────

/**
 * Make an authenticated OData GET request to the RESO Web API.
 *
 * @param {string} resource  RESO resource name, e.g. 'Property', 'Member', 'Media'
 * @param {object} [odata]   OData query options
 * @param {string}   [odata.$filter]
 * @param {string}   [odata.$select]
 * @param {string}   [odata.$orderby]
 * @param {number}   [odata.$top]
 * @param {number}   [odata.$skip]
 * @param {string}   [odata.$expand]
 * @param {boolean}  [odata.$count]
 * @returns {Promise<{value: object[], '@odata.count'?: number, '@odata.nextLink'?: string}>}
 */
async function resoGet(resource, odata = {}) {
  const params = new URLSearchParams();
  if (odata.$filter)  params.set('$filter',  odata.$filter);
  if (odata.$select)  params.set('$select',  odata.$select);
  if (odata.$orderby) params.set('$orderby', odata.$orderby);
  if (odata.$top      != null) params.set('$top',    String(odata.$top));
  if (odata.$skip     != null) params.set('$skip',   String(odata.$skip));
  if (odata.$expand)  params.set('$expand',  odata.$expand);
  if (odata.$count)   params.set('$count',   'true');

  const qs  = params.toString();
  const url = `${config.reso.baseUrl}/${resource}${qs ? '?' + qs : ''}`;

  // Auth retry: clear token and reacquire exactly once on 401.
  for (let authAttempt = 1; authAttempt <= 2; authAttempt++) {
    const token = await getBearerToken();

    for (let requestAttempt = 1; requestAttempt <= RESO_HTTP_MAX_RETRIES + 1; requestAttempt++) {
      try {
        const res = await fetchWithTimeout(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept:        'application/json',
            'User-Agent':  'DonnaSellsLV-Platform/2.0',
          },
        }, RESO_HTTP_TIMEOUT_MS, `GET ${resource} attempt=${requestAttempt} authAttempt=${authAttempt}`);

        if (res.status === 401) {
          _tokenCache = null;
          if (authAttempt === 1) {
            break;
          }
          throw new ResoAuthError(`RESO API returned 401 Unauthorized for ${resource}`);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new ResoApiError(
            `RESO API error ${res.status} for ${resource}: ${text.slice(0, 300)}`,
            res.status
          );
        }

        const rawBody = await res.text();
        let parsed;
        try {
          parsed = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          parsed = rawBody;
        }
        return normalizeResoPayload(parsed, resource);
      } catch (err) {
        if (!isRetryableRequestError(err) || requestAttempt > RESO_HTTP_MAX_RETRIES) {
          throw err;
        }
        await backoff(requestAttempt);
      }
    }
  }

  throw new ResoAuthError(`Unable to authenticate RESO request for ${resource}.`);
}

// ─── High-level helpers ───────────────────────────────────────────────────────

/**
 * Fetch a page of Property (listing) records.
 *
 * @param {object} opts
 * @param {string} [opts.filter]          OData $filter expression
 * @param {string} [opts.modifiedSince]   ISO 8601 timestamp for incremental sync
 * @param {number} [opts.top]             page size (default: config.sync.batchSize)
 * @param {number} [opts.skip]            offset
 * @param {string} [opts.select]          comma-separated field list
 * @returns {Promise<{listings: object[], count: number|null, nextLink: string|null}>}
 */
async function fetchListings({ filter, modifiedSince, top, skip = 0, select } = {}) {
  if (config.reso.mock) {
    const all = getMockListings();
    const page = all.slice(skip, skip + (top ?? config.sync.batchSize));
    return { listings: page, count: all.length, nextLink: null };
  }

  const filters = [];

  if (filter)       filters.push(filter);
  if (modifiedSince) {
    filters.push(`ModificationTimestamp gt ${modifiedSince}`);
  }

  const $filter = filters.join(' and ') || undefined;

  const result = await resoGet('Property', {
    $filter,
    $select: select || LISTING_SELECT,
    $orderby: 'ModificationTimestamp asc',
    $top:  top ?? config.sync.batchSize,
    $skip: skip,
    $count: true,
    $expand: 'Media',
  });

  return {
    listings: result.value || [],
    count:    result['@odata.count'] ?? null,
    nextLink: result['@odata.nextLink'] ?? null,
  };
}

/**
 * Fetch all listings modified since a given timestamp by iterating pages.
 *
 * @param {string|null} modifiedSince  ISO 8601, or null for full sync
 * @param {function}    onBatch        async (listings: object[]) => void
 * @returns {Promise<{total: number, pages: number}>}
 */
async function fetchAllListings(modifiedSince, onBatch) {
  const batchSize = config.sync.batchSize;
  let   skip      = 0;
  let   total     = 0;
  let   pages     = 0;

  while (true) {
    const { listings, count, nextLink } = await fetchListings({
      modifiedSince: modifiedSince || undefined,
      top:  batchSize,
      skip,
    });

    if (!listings.length) break;

    await onBatch(listings);
    total += listings.length;
    pages++;
    skip  += batchSize;

    // Stop when we've consumed all records (count known) or no nextLink
    if (count !== null && skip >= count) break;
    if (!nextLink && listings.length < batchSize) break;
  }

  return { total, pages };
}

/**
 * Verify the RESO connection and return account info.
 * @returns {Promise<{connected:boolean, account:string}>}
 */
async function verifyConnection() {
  if (config.reso.mock) {
    return { connected: true, endpoint: 'mock (RESO_MOCK=true)', mock: true };
  }
  const result = await resoGet('$metadata', {});
  return { connected: true, endpoint: config.reso.baseUrl };
}

// ─── RESO Standard field selection ───────────────────────────────────────────

const LISTING_SELECT = [
  'ListingId', 'ListingKey', 'MlsStatus',
  'ListPrice', 'OriginalListPrice',
  'StreetNumber', 'StreetName', 'UnitNumber',
  'City', 'StateOrProvince', 'PostalCode', 'CountyOrParish',
  'Latitude', 'Longitude',
  'BedroomsTotal', 'BathroomsTotalInteger', 'BathroomsFull', 'BathroomsHalf',
  'LivingArea', 'LotSizeSquareFeet', 'LotSizeAcres',
  'PropertyType', 'PropertySubType', 'YearBuilt', 'GarageSpaces',
  'PoolPrivateYN', 'SpaYN', 'View', 'ViewYN',
  'AssociationFee', 'AssociationFeeFrequency',
  'ListOfficeName', 'ListOfficeKey', 'ListOfficeMlsId',
  'ListAgentFullName', 'ListAgentKey', 'ListAgentMlsId',
  'ListingContractDate', 'OnMarketDate', 'ModificationTimestamp',
  'PublicRemarks',
  'CommunityFeatures', 'InteriorFeatures', 'ExteriorFeatures',
  'Heating', 'Cooling', 'FireplaceYN', 'FireplacesTotal',
  'LaundryFeatures', 'ParkingFeatures', 'Roof', 'FoundationDetails',
  'IDXDisplayAllowed',
].join(',');

// ─── RESO → normalised DB field mapping ──────────────────────────────────────

/**
 * Map a raw RESO Property record to the DB schema used by upsertListing().
 * @param {object} r  raw RESO record
 * @param {string} courtesyOf
 * @param {string} disclaimer
 * @returns {object}
 */
function mapResoToDb(r, courtesyOf, disclaimer) {
  return {
    listing_id:            r.ListingId,
    mls_status:            r.MlsStatus,
    list_price:            r.ListPrice,
    original_list_price:   r.OriginalListPrice,
    street_number:         r.StreetNumber,
    street_name:           r.StreetName,
    unit_number:           r.UnitNumber,
    city:                  r.City,
    state_or_province:     r.StateOrProvince,
    postal_code:           r.PostalCode,
    county:                r.CountyOrParish,
    latitude:              r.Latitude,
    longitude:             r.Longitude,
    bedrooms_total:        r.BedroomsTotal,
    bathrooms_total:       r.BathroomsTotalInteger,
    bathrooms_full:        r.BathroomsFull,
    bathrooms_half:        r.BathroomsHalf,
    living_area:           r.LivingArea,
    lot_size_sqft:         r.LotSizeSquareFeet,
    lot_size_acres:        r.LotSizeAcres,
    property_type:         r.PropertyType,
    property_sub_type:     r.PropertySubType,
    year_built:            r.YearBuilt,
    garage_spaces:         r.GarageSpaces,
    pool_yn:               r.PoolPrivateYN ?? false,
    spa_yn:                r.SpaYN ?? false,
    view_yn:               r.ViewYN ?? false,
    view_description:      Array.isArray(r.View) ? r.View.join(', ') : r.View || null,
    hoa_fee:               r.AssociationFee,
    hoa_fee_frequency:     r.AssociationFeeFrequency,
    list_office_name:      r.ListOfficeName,
    list_agent_full_name:  r.ListAgentFullName,
    list_agent_mls_id:     r.ListAgentMlsId,
    listing_contract_date: r.ListingContractDate,
    on_market_date:        r.OnMarketDate,
    modification_timestamp: r.ModificationTimestamp,
    public_remarks:        r.PublicRemarks,
    community_features:    Array.isArray(r.CommunityFeatures) ? r.CommunityFeatures.join(', ') : r.CommunityFeatures || null,
    interior_features:     Array.isArray(r.InteriorFeatures)  ? r.InteriorFeatures.join(', ')  : r.InteriorFeatures  || null,
    exterior_features:     Array.isArray(r.ExteriorFeatures)  ? r.ExteriorFeatures.join(', ')  : r.ExteriorFeatures  || null,
    heating:               Array.isArray(r.Heating)           ? r.Heating.join(', ')           : r.Heating           || null,
    cooling:               Array.isArray(r.Cooling)           ? r.Cooling.join(', ')           : r.Cooling           || null,
    fireplace_yn:          r.FireplaceYN ?? false,
    fireplaces_total:      r.FireplacesTotal,
    laundry_features:      Array.isArray(r.LaundryFeatures)   ? r.LaundryFeatures.join(', ')   : r.LaundryFeatures   || null,
    parking_features:      Array.isArray(r.ParkingFeatures)   ? r.ParkingFeatures.join(', ')   : r.ParkingFeatures   || null,
    roof:                  Array.isArray(r.Roof)               ? r.Roof.join(', ')               : r.Roof               || null,
    foundation_details:    Array.isArray(r.FoundationDetails) ? r.FoundationDetails.join(', ') : r.FoundationDetails || null,
    idx_display_allowed:   r.IDXDisplayAllowed !== false,
    attribution_courtesy_of:  courtesyOf,
    attribution_disclaimer:   disclaimer,
  };
}

/**
 * Extract media items from a RESO Property record.
 * RESO Media is returned as an expanded collection on the Property record.
 *
 * @param {object} r  raw RESO record
 * @returns {Array<{url:string, mediaType:string, order:number, caption:string|null}>}
 */
function extractMedia(r) {
  const mediaList = r.Media || r.Photos || [];
  return Array.isArray(mediaList)
    ? mediaList.map((m, i) => ({
        url:       m.MediaURL || m.Uri || m.uri || '',
        mediaType: (m.MediaCategory || 'Photo').toLowerCase() === 'photo' ? 'photo' : 'video',
        order:     m.Order ?? m.MediaOrder ?? i,
        caption:   m.ShortDescription || m.MediaCaption || null,
      })).filter((m) => m.url)
    : [];
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  const label = options._label || 'HTTP';
  try {
    const { _label, ...fetchOptions } = options;
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    const requestId = res.headers.get('x-request-id') || 'n/a';
    const elapsed = Date.now() - started;
    console.log(`[reso-client] [${elapsed}ms] ${label} status=${res.status} request_id=${requestId}`);
    return res;
  } catch (err) {
    const elapsed = Date.now() - started;
    console.warn(`[reso-client] [${elapsed}ms] ${label} failed: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeResoPayload(json, resource) {
  // OData: expected shape { value: [...] }
  if (json && typeof json === 'object' && Array.isArray(json.value)) {
    return json;
  }

  // Legacy Spark compatibility: { D: { Results: [...] } }
  if (json?.D && Array.isArray(json.D.Results)) {
    return {
      value: json.D.Results,
      '@odata.count': Number.isFinite(Number(json.D.TotalCount)) ? Number(json.D.TotalCount) : null,
      '@odata.nextLink': null,
    };
  }

  // Metadata endpoint can return XML string in some environments.
  if (resource === '$metadata' && typeof json === 'string') {
    return { value: [], metadata: json };
  }

  // As a strict safeguard, fail fast on unknown shapes.
  if (json && typeof json === 'object') {
    const keys = Object.keys(json).slice(0, 8).join(', ');
    throw new ResoApiError(`Unexpected RESO payload shape for ${resource}. Keys: ${keys}`, 502);
  }

  return { value: Array.isArray(json) ? json : [json] };
}

function isRetryableNetworkError(err) {
  return err && (
    err.name === 'AbortError' ||
    /timed?\s*out/i.test(err.message) ||
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|fetch failed/i.test(err.message)
  );
}

function isRetryableRequestError(err) {
  if (isRetryableNetworkError(err)) return true;
  if (err instanceof ResoApiError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(err.status);
  }
  return false;
}

async function backoff(attempt) {
  const ms = Math.min(1500, 200 * (2 ** (attempt - 1)));
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Error classes ────────────────────────────────────────────────────────────

class ResoConfigError extends Error {
  constructor(msg) { super(msg); this.name = 'ResoConfigError'; }
}
class ResoAuthError extends Error {
  constructor(msg) { super(msg); this.name = 'ResoAuthError'; }
}
class ResoApiError extends Error {
  constructor(msg, status) { super(msg); this.name = 'ResoApiError'; this.status = status; }
}

module.exports = {
  getBearerToken,
  resoGet,
  fetchListings,
  fetchAllListings,
  verifyConnection,
  mapResoToDb,
  extractMedia,
  ResoConfigError,
  ResoAuthError,
  ResoApiError,
};
