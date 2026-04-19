/**
 * GET /api/idx/verify
 *
 * Verifies that the site has a valid, authenticated connection to the MLS/IDX
 * provider and returns the account's active permissions.
 *
 * Response 200:
 *   { connected: true, accountId: "...", permissions: ["ActiveListings", ...] }
 *
 * Response 503:
 *   { connected: false, error: "..." }
 */

'use strict';

const { verifyConnection, IdxConfigError, IdxAuthError, IdxApiError } = require('./_lib/client');

const CORS_ORIGIN = process.env.SITE_ORIGIN || 'https://www.donnasellslv.com';

module.exports = async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  setCorsHeaders(res, CORS_ORIGIN);

  try {
    const result = await verifyConnection();
    return res.status(200).json(result);
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
  res.setHeader('Cache-Control', 'no-store');
}

function classifyError(err) {
  if (err instanceof IdxConfigError) {
    console.error('[idx/verify] Configuration error:', err.message);
    return { status: 503, body: { connected: false, error: 'IDX gateway not configured. Contact the site administrator.' } };
  }
  if (err instanceof IdxAuthError) {
    console.error('[idx/verify] Auth error:', err.message);
    return { status: 503, body: { connected: false, error: 'MLS authentication failed. Verify IDX credentials.' } };
  }
  if (err instanceof IdxApiError) {
    console.error('[idx/verify] API error:', err.message);
    return { status: err.status >= 500 ? 502 : 503, body: { connected: false, error: 'MLS provider returned an error. Try again shortly.' } };
  }
  if (err && err.name === 'AbortError') {
    console.error('[idx/verify] Timeout connecting to MLS.');
    return { status: 504, body: { connected: false, error: 'MLS provider did not respond in time.' } };
  }
  console.error('[idx/verify] Unexpected error:', err);
  return { status: 500, body: { connected: false, error: 'An unexpected error occurred.' } };
}
