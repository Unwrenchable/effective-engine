/**
 * IDX / MLS API client for GLVAR MLS access.
 *
 * Supports two modes:
 *
 * 1. Spark API (Bridge Interactive) — current default.
 *    Uses proprietary _filter/_limit query params.
 *    Environment variables:
 *      IDX_BASE_URL       – e.g. https://api.sparkapi.com  (no trailing slash)
 *      IDX_CLIENT_ID      – OAuth2 client_id
 *      IDX_CLIENT_SECRET  – OAuth2 client_secret
 *      IDX_API_KEY        – optional static bearer token (takes precedence)
 *
 * 2. RESO Web API (direct GLVAR feed — requires Vendor/Franchisor license).
 *    OData 4.0 standard; activated when RESO_BASE_URL is set.
 *    Environment variables:
 *      RESO_BASE_URL      – e.g. https://replication.sparkapi.com/Reso/OData
 *      RESO_CLIENT_ID     – OAuth2 client_id for RESO endpoint
 *      RESO_CLIENT_SECRET – OAuth2 client_secret for RESO endpoint
 *      RESO_API_KEY       – optional static bearer token (takes precedence)
 *
 * The Vercel proxy functions continue to use this client so the front-end
 * IDX search keeps working during the migration to the new platform server.
 */

'use strict';

const IDX_BASE_URL    = (process.env.IDX_BASE_URL    || 'https://api.sparkapi.com').replace(/\/$/, '');
const IDX_CLIENT_ID   = process.env.IDX_CLIENT_ID    || '';
const IDX_CLIENT_SECRET = process.env.IDX_CLIENT_SECRET || '';
const IDX_API_KEY     = process.env.IDX_API_KEY       || '';

// RESO Web API (direct feed) — used when RESO_BASE_URL is configured
const RESO_BASE_URL    = (process.env.RESO_BASE_URL    || '').replace(/\/$/, '');
const RESO_CLIENT_ID   = process.env.RESO_CLIENT_ID    || '';
const RESO_CLIENT_SECRET = process.env.RESO_CLIENT_SECRET || '';
const RESO_API_KEY     = process.env.RESO_API_KEY       || '';

// In-process token caches (lives for the duration of a warm function instance)
let _tokenCache     = null; // { access_token, expires_at } — Spark
let _resoTokenCache = null; // { access_token, expires_at } — RESO direct

// ─── Mode detection ───────────────────────────────────────────────────────────
// Use RESO Web API when RESO_BASE_URL is set; otherwise fall back to Spark.
const USE_RESO = Boolean(RESO_BASE_URL);

/**
 * Obtain a valid Bearer token for the Spark API.
 * Uses IDX_API_KEY directly when available; otherwise fetches an OAuth2
 * Client Credentials grant and caches it until 60 s before expiry.
 *
 * @returns {Promise<string>} Bearer token
 */
async function getBearerToken() {
  if (IDX_API_KEY) return IDX_API_KEY;

  if (!IDX_CLIENT_ID || !IDX_CLIENT_SECRET) {
    throw new IdxConfigError(
      'IDX credentials not configured. Set IDX_CLIENT_ID and IDX_CLIENT_SECRET ' +
      '(or IDX_API_KEY) as environment variables in your Vercel project.'
    );
  }

  const now = Date.now();
  const bufferMs = Math.max(30_000, ((_tokenCache?.expires_at ?? 0) - now) * 0.1);
  if (_tokenCache && _tokenCache.expires_at > now + bufferMs) {
    return _tokenCache.access_token;
  }

  const tokenUrl = `${IDX_BASE_URL}/oauth2/grant`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     IDX_CLIENT_ID,
    client_secret: IDX_CLIENT_SECRET,
  });

  const res = await fetchWithTimeout(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IdxAuthError(
      `IDX token request failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new IdxAuthError('IDX token response missing access_token field.');
  }

  _tokenCache = {
    access_token: data.access_token,
    expires_at:   now + (data.expires_in || 3600) * 1000,
  };
  return _tokenCache.access_token;
}

/**
 * Make an authenticated GET request to the IDX API.
 *
 * @param {string} path   – API path, e.g. '/v1/listings'
 * @param {URLSearchParams|Record<string,string>} [query]
 * @returns {Promise<unknown>} Parsed JSON response body
 */
async function idxGet(path, query) {
  const token = await getBearerToken();
  const qs    = query ? '?' + new URLSearchParams(query).toString() : '';
  const url   = `${IDX_BASE_URL}${path}${qs}`;

  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'X-SparkApi-User-Agent': 'DonnaSellsLV/1.0',
    },
  });

  if (res.status === 401) {
    // Force token refresh on next call
    _tokenCache = null;
    throw new IdxAuthError(`IDX API returned 401 Unauthorized for ${path}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IdxApiError(
      `IDX API error ${res.status} for ${path}: ${text.slice(0, 300)}`,
      res.status
    );
  }

  return res.json();
}

/**
 * Verify the MLS connection: authenticate and confirm the account has
 * IDX permissions by fetching the /v1/my/account endpoint.
 *
 * @returns {Promise<{connected:boolean, permissions:string[], accountId:string}>}
 */
async function verifyConnection() {
  const token = await getBearerToken();
  const url   = `${IDX_BASE_URL}/v1/my/account`;

  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'X-SparkApi-User-Agent': 'DonnaSellsLV/1.0',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IdxApiError(
      `MLS account check failed (${res.status}): ${text.slice(0, 300)}`,
      res.status
    );
  }

  const data = await res.json();
  const account = data?.D?.Results?.[0] ?? data;

  const permissions = [
    account?.MlsPermissions?.ActiveListings !== false && 'ActiveListings',
    account?.MlsPermissions?.SoldListings    !== false && 'SoldListings',
    account?.MlsPermissions?.RentalListings  !== false && 'RentalListings',
    account?.MlsPermissions?.CommercialListings !== false && 'CommercialListings',
  ].filter(Boolean);

  return {
    connected:  true,
    accountId:  account?.Id ?? account?.AccountId ?? 'unknown',
    permissions,
  };
}

// ─── RESO Web API (OData 4.0) support ────────────────────────────────────────
// Activated when RESO_BASE_URL is set in the environment.
// Provides a standards-based direct MLS feed once you hold a vendor license.

/**
 * Obtain a Bearer token for the RESO direct feed endpoint.
 * @returns {Promise<string>}
 */
async function resoGetToken() {
  if (RESO_API_KEY) return RESO_API_KEY;

  if (!RESO_CLIENT_ID || !RESO_CLIENT_SECRET) {
    throw new IdxConfigError(
      'RESO direct feed credentials not configured. Set RESO_CLIENT_ID and ' +
      'RESO_CLIENT_SECRET (or RESO_API_KEY).'
    );
  }

  const now      = Date.now();
  const bufferMs = 60_000;
  if (_resoTokenCache && _resoTokenCache.expires_at > now + bufferMs) {
    return _resoTokenCache.access_token;
  }

  // OAuth2 token URL is adjacent to the OData base path
  const tokenUrl = RESO_BASE_URL.replace('/Reso/OData', '') + '/oauth2/grant';
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     RESO_CLIENT_ID,
    client_secret: RESO_CLIENT_SECRET,
  });

  const res = await fetchWithTimeout(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IdxAuthError(`RESO token request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new IdxAuthError('RESO token response missing access_token.');

  _resoTokenCache = {
    access_token: data.access_token,
    expires_at:   now + (data.expires_in || 3600) * 1000,
  };
  return _resoTokenCache.access_token;
}

/**
 * Make an authenticated OData GET request to the RESO Web API.
 *
 * @param {string} resource  RESO resource, e.g. 'Property'
 * @param {object} [params]  OData query options: $filter, $select, $top, $skip, $orderby, $expand
 * @returns {Promise<{value: object[], '@odata.count'?: number}>}
 */
async function resoGet(resource, params = {}) {
  if (!RESO_BASE_URL) {
    throw new IdxConfigError('RESO_BASE_URL is not set. Configure the RESO direct feed endpoint.');
  }

  const token = await resoGetToken();
  const qs    = params && Object.keys(params).length
    ? '?' + new URLSearchParams(params).toString()
    : '';
  const url   = `${RESO_BASE_URL}/${resource}${qs}`;

  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'User-Agent':  'DonnaSellsLV/2.0',
    },
  }, 30_000);

  if (res.status === 401) {
    _resoTokenCache = null;
    throw new IdxAuthError(`RESO API 401 Unauthorized for ${resource}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IdxApiError(`RESO API error ${res.status} for ${resource}: ${text.slice(0, 300)}`, res.status);
  }

  const json = await res.json();
  // OData standard: results in 'value' array
  if (Array.isArray(json?.value)) return json;
  // Spark RESO compat
  if (json?.D?.Results) return { value: json.D.Results, '@odata.count': json.D.TotalCount };
  return { value: Array.isArray(json) ? json : [json] };
}

// ─── fetch with timeout ──────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Custom error classes ────────────────────────────────────────────────────

class IdxConfigError extends Error {
  constructor(message) { super(message); this.name = 'IdxConfigError'; }
}
class IdxAuthError extends Error {
  constructor(message) { super(message); this.name = 'IdxAuthError'; }
}
class IdxApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name   = 'IdxApiError';
    this.status = status;
  }
}

module.exports = { getBearerToken, idxGet, verifyConnection, IdxConfigError, IdxAuthError, IdxApiError, resoGetToken, resoGet };
