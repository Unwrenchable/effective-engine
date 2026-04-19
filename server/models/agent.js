'use strict';

const { query } = require('./db');

/**
 * Get an agent's active listings.
 * @param {string} agentMlsId
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
async function getAgentListings(agentMlsId, limit = 20) {
  const result = await query(
    `SELECT
       l.id, l.listing_id, l.mls_status, l.list_price,
       l.street_number, l.street_name, l.city, l.state_or_province, l.postal_code,
       l.bedrooms_total, l.bathrooms_total, l.living_area,
       l.property_type, l.property_sub_type,
       l.on_market_date, l.modification_timestamp,
       l.list_agent_full_name, l.list_office_name,
       l.attribution_courtesy_of, l.attribution_disclaimer,
       (SELECT m.cdn_url FROM listing_media m
        WHERE m.listing_id = l.id AND m.media_type = 'photo'
        ORDER BY m.media_order LIMIT 1) AS primary_photo
     FROM listings l
     WHERE l.list_agent_mls_id = $1
       AND l.mls_status IN ('Active', 'ActiveUnderContract', 'ComingSoon')
       AND l.idx_display_allowed IS NOT FALSE
     ORDER BY l.list_price DESC
     LIMIT $2`,
    [agentMlsId, limit]
  );
  return result.rows;
}

/**
 * Get agent profile by MLS ID.
 * @param {string} agentMlsId
 * @returns {Promise<object|null>}
 */
async function getAgentProfile(agentMlsId) {
  const result = await query(
    `SELECT * FROM agents WHERE mls_id = $1`,
    [agentMlsId]
  );
  return result.rows[0] || null;
}

module.exports = { getAgentListings, getAgentProfile };
