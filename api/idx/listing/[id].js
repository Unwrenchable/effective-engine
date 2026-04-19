/**
 * GET /api/idx/listing/[id]
 *
 * Fetches a single MLS listing by its ListingId (MLS#) and returns the
 * full compliance-filtered detail record.
 *
 * Route parameter:
 *   id – MLS listing number (alphanumeric, up to 20 characters)
 *
 * Response 200:
 *   { listing: { ...compliance-filtered fields }, disclaimer: "..." }
 *
 * Response 404:
 *   { error: "Listing not found." }
 */

'use strict';

const { idxGet, IdxConfigError, IdxAuthError, IdxApiError } = require('../_lib/client');
const { applyComplianceRules, buildAttribution }             = require('../_lib/compliance');

const CORS_ORIGIN = process.env.SITE_ORIGIN || 'https://www.donnasellslv.com';

// Allow only safe MLS ID characters to prevent injection
const SAFE_ID_RE = /^[a-zA-Z0-9\-]{1,20}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  setCorsHeaders(res, CORS_ORIGIN);

  const { id } = req.query;

  if (!id || !SAFE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid listing ID.' });
  }

  const sparkParams = {
    _filter:  `ListingId Eq '${id}'`,
    _limit:   '1',
    _expand:  'Photos,Videos,Documents,GreenBuildingVerification,OpenHouse',
    _select:  [
      'ListingId', 'MlsStatus', 'ListPrice', 'OriginalListPrice',
      'StreetNumber', 'StreetName', 'UnitNumber',
      'City', 'StateOrProvince', 'PostalCode', 'CountyOrParish',
      'Latitude', 'Longitude',
      'BedroomsTotal', 'BathroomsTotalInteger', 'BathroomsFull', 'BathroomsHalf',
      'LivingArea', 'LotSizeSquareFeet', 'LotSizeAcres',
      'PropertyType', 'PropertySubType', 'YearBuilt', 'GarageSpaces',
      'PoolPrivateYN', 'SpaYN', 'View', 'ViewYN',
      'AssociationFee', 'AssociationFeeFrequency',
      'ListOfficeName', 'ListAgentFullName',
      'ModificationTimestamp', 'ListingContractDate', 'OnMarketDate',
      'PublicRemarks', 'Photos', 'Videos', 'OpenHouse',
      'CommunityFeatures', 'InteriorFeatures', 'ExteriorFeatures',
      'Heating', 'Cooling', 'FireplaceYN', 'FireplacesTotal',
      'LaundryFeatures', 'ParkingFeatures', 'Roof', 'FoundationDetails',
      'IDXDisplayAllowed',
    ].join(','),
  };

  try {
    const data = await idxGet('/v1/listings', sparkParams);

    const rawListings = data?.D?.Results ?? data?.Results ?? data ?? [];
    if (!rawListings.length) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = applyComplianceRules(rawListings[0]);
    if (!listing) {
      // Listing exists but is not IDX-display eligible
      return res.status(404).json({ error: 'Listing not available for display.' });
    }

    return res.status(200).json({
      listing,
      disclaimer: listing._attribution?.mlsDisclaimer ?? buildAttribution({}).mlsDisclaimer,
    });
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
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
}

function classifyError(err) {
  if (err instanceof IdxConfigError) {
    console.error('[idx/listing] Config error:', err.message);
    return { status: 503, body: { error: 'IDX gateway not configured.' } };
  }
  if (err instanceof IdxAuthError) {
    console.error('[idx/listing] Auth error:', err.message);
    return { status: 503, body: { error: 'MLS authentication failed.' } };
  }
  if (err instanceof IdxApiError) {
    console.error('[idx/listing] API error:', err.message);
    return { status: err.status >= 500 ? 502 : 503, body: { error: 'MLS provider error.' } };
  }
  if (err && err.name === 'AbortError') {
    return { status: 504, body: { error: 'MLS provider timed out.' } };
  }
  console.error('[idx/listing] Unexpected error:', err);
  return { status: 500, body: { error: 'An unexpected error occurred.' } };
}
