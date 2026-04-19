'use strict';

/**
 * GLVAR / IDX display-rule compliance service.
 * Mirrors and extends the existing api/idx/_lib/compliance.js logic
 * for use in the new server layer.
 */

// Fields that must never be returned to public consumers (GLVAR IDX rules)
const REDACTED_FIELDS = new Set([
  'SellerAgentMlsId', 'SellerAgentKey', 'SellerOfficeMlsId', 'SellerOfficeKey',
  'OwnerName', 'TaxLegalDescription', 'TaxParcelNumber',
  'PrivateRemarks', 'ShowingInstructions', 'SellerConcessions',
  'RawContactData', 'OriginatingSystemMemberID',
  'list_agent_mls_id',   // DB equivalents
  'list_office_mls_id',
  'private_remarks',
  'showing_instructions',
]);

const MAX_IDX_PHOTOS = 25;

const ACTIVE_STATUSES = new Set(['Active', 'ActiveUnderContract', 'ComingSoon']);

/**
 * Filter a raw listing object (from DB or API) for IDX-compliant public display.
 * Returns null if the listing must not be shown.
 *
 * @param {object} listing
 * @returns {object|null}
 */
function applyComplianceRules(listing) {
  if (!listing || typeof listing !== 'object') return null;
  if (listing.idx_display_allowed === false || listing.IDXDisplayAllowed === false) return null;
  if (listing.mls_status && !ACTIVE_STATUSES.has(listing.mls_status)) return null;
  if (listing.MlsStatus  && !ACTIVE_STATUSES.has(listing.MlsStatus))  return null;

  const clean = {};
  for (const [key, value] of Object.entries(listing)) {
    if (!REDACTED_FIELDS.has(key)) clean[key] = value;
  }

  // Cap photos
  if (Array.isArray(clean.photos))  clean.photos  = clean.photos.slice(0, MAX_IDX_PHOTOS);
  if (Array.isArray(clean.media))   clean.media   = clean.media.slice(0, MAX_IDX_PHOTOS);
  if (Array.isArray(clean.Photos))  clean.Photos  = clean.Photos.slice(0, MAX_IDX_PHOTOS);

  // Ensure attribution is present
  if (!clean._attribution) {
    clean._attribution = buildAttribution(listing);
  }

  return clean;
}

/**
 * Filter an array of listings, removing any that fail compliance.
 * @param {object[]} listings
 * @returns {object[]}
 */
function applyComplianceToList(listings) {
  if (!Array.isArray(listings)) return [];
  return listings.map(applyComplianceRules).filter(Boolean);
}

/**
 * Build the "courtesy of" attribution required by GLVAR IDX policy.
 * @param {object} listing
 * @returns {{courtesyOf: string, mlsDisclaimer: string}}
 */
function buildAttribution(listing) {
  const officeName = listing.list_office_name  || listing.ListOfficeName  || '';
  const agentName  = listing.list_agent_full_name || listing.ListAgentFullName || '';
  const mlsId      = listing.listing_id        || listing.ListingId       || '';

  const courtesyParts = ['Courtesy of'];
  if (officeName) courtesyParts.push(officeName);
  if (agentName)  courtesyParts.push(`(${agentName})`);
  if (mlsId)      courtesyParts.push(`· MLS# ${mlsId}`);

  return {
    courtesyOf:    courtesyParts.join(' '),
    mlsDisclaimer: 'Information deemed reliable but not guaranteed. ' +
      'Listing data © Greater Las Vegas Association of REALTORS® (GLVAR). ' +
      'IDX information is provided exclusively for consumers\' personal, ' +
      'non-commercial use and may not be used for any purpose other than to ' +
      'identify prospective properties consumers may be interested in purchasing.',
  };
}

/**
 * Attach attribution fields to listings that came from the local DB
 * (which stores attribution_courtesy_of / attribution_disclaimer directly).
 * @param {object} listing
 * @returns {object}
 */
function attachDbAttribution(listing) {
  return {
    ...listing,
    _attribution: {
      courtesyOf:    listing.attribution_courtesy_of  || buildAttribution(listing).courtesyOf,
      mlsDisclaimer: listing.attribution_disclaimer   || buildAttribution(listing).mlsDisclaimer,
    },
  };
}

module.exports = { applyComplianceRules, applyComplianceToList, buildAttribution, attachDbAttribution };
