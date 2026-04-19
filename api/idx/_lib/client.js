/**
 * Spark API (Bridge Interactive) client for GLVAR MLS access.
 *
 * Environment variables (set in Vercel dashboard, never committed):
 *   IDX_CLIENT_ID      – OAuth2 client_id issued by your IDX provider
 *   IDX_CLIENT_SECRET  – OAuth2 client_secret
 *   IDX_BASE_URL       – e.g. https://api.sparkapi.com  (no trailing slash)
 *   IDX_API_KEY        – optional bearer token if provider uses API keys
 *                        instead of OAuth2 (takes precedence when set)
 */

'use strict';

const IDX_BASE_URL    = (process.env.IDX_BASE_URL    || 'https://api.sparkapi.com').replace(/\/$/, '');
const IDX_CLIENT_ID   = process.env.IDX_CLIENT_ID    || '';
const IDX_CLIENT_SECRET = process.env.IDX_CLIENT_SECRET || '';
const IDX_API_KEY     = process.env.IDX_API_KEY       || '';

// In-process token cache (lives for the duration of a warm function instance)
let _tokenCache = null; // { access_token, expires_at }

/**
 * Obtain a valid Bearer token.
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
  if (_tokenCache && _tokenCache.expires_at > now + 60_000) {
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

module.exports = { getBearerToken, idxGet, verifyConnection, IdxConfigError, IdxAuthError, IdxApiError };
