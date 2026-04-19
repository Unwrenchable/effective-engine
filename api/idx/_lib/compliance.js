/**
 * GLVAR / IDX display-rule compliance filters.
 *
 * Implements the minimum required IDX display rules for the Greater Las Vegas
 * Association of REALTORS® (GLVAR) and the general NAR IDX policy:
 *   - Strip listings that have opted out of IDX display
 *   - Remove fields that must not be shown to the public
 *   - Enforce required "courtesy of" attribution
 *   - Redact personally identifiable seller information
 *   - Cap photo count at MLS-permitted maximum
 */

'use strict';

// Fields that must never be forwarded to the browser per GLVAR IDX rules
const REDACTED_FIELDS = new Set([
  'SellerAgentMlsId',
  'SellerAgentKey',
  'SellerOfficeMlsId',
  'SellerOfficeKey',
  'OwnerName',
  'TaxLegalDescription',
  'TaxParcelNumber',
  'PrivateRemarks',
  'ShowingInstructions',
  'SellerConcessions',
  'RawContactData',
  'OriginatingSystemMemberID',
]);

// Maximum number of photos allowed in an IDX display (GLVAR rule)
const MAX_IDX_PHOTOS = 25;

/**
 * Filter a single listing object for IDX-compliant public display.
 *
 * @param {Record<string, unknown>} listing – Raw listing from the MLS API
 * @returns {Record<string, unknown>|null}   Compliant listing, or null if
 *                                            the listing must not be shown
 */
function applyComplianceRules(listing) {
  if (!listing || typeof listing !== 'object') return null;

  // Respect the MLS opt-out flag
  if (listing.IDXDisplayAllowed === false || listing.IDXOptOut === true) {
    return null;
  }

  // Remove expired or non-active listings from IDX display
  const activeStatuses = new Set(['Active', 'ActiveUnderContract', 'ComingSoon']);
  if (listing.MlsStatus && !activeStatuses.has(listing.MlsStatus)) {
    return null;
  }

  // Build a clean copy of the listing
  const clean = {};
  for (const [key, value] of Object.entries(listing)) {
    if (!REDACTED_FIELDS.has(key)) {
      clean[key] = value;
    }
  }

  // Cap photos at the permitted maximum
  if (Array.isArray(clean.Media)) {
    clean.Media = clean.Media.slice(0, MAX_IDX_PHOTOS);
  }
  if (Array.isArray(clean.Photos)) {
    clean.Photos = clean.Photos.slice(0, MAX_IDX_PHOTOS);
  }

  // Ensure required attribution fields are present
  clean._attribution = buildAttribution(listing);

  return clean;
}

/**
 * Apply compliance rules to an array of listings, removing any that fail.
 *
 * @param {unknown[]} listings
 * @returns {Record<string, unknown>[]}
 */
function applyComplianceToList(listings) {
  if (!Array.isArray(listings)) return [];
  return listings.map(applyComplianceRules).filter(Boolean);
}

/**
 * Build the "courtesy of" attribution line required by GLVAR IDX policy.
 * Must be rendered adjacent to every listing display.
 *
 * @param {Record<string, unknown>} listing
 * @returns {{courtesyOf: string, mlsDisclaimer: string}}
 */
function buildAttribution(listing) {
  const officeName  = listing.ListOfficeName   || listing.ListingOffice || '';
  const agentName   = listing.ListAgentFullName || listing.ListAgentFirstName
    ? [listing.ListAgentFirstName, listing.ListAgentLastName].filter(Boolean).join(' ')
    : '';
  const mlsId       = listing.ListingId        || listing.MlsId || '';

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

module.exports = { applyComplianceRules, applyComplianceToList, buildAttribution };
