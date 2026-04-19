'use strict';

const { query } = require('./db');

/**
 * Get market statistics for a given area.
 *
 * @param {object} opts
 * @param {string} [opts.city]
 * @param {string} [opts.postalCode]
 * @param {string} [opts.propertyType]
 * @param {number} [opts.lookbackDays]  default 30
 * @returns {Promise<object>}
 */
async function getMarketStats({ city, postalCode, propertyType, lookbackDays = 30 } = {}) {
  const conditions = [`l.mls_status = 'Active'`];
  const params     = [];
  let   p          = 1;

  if (city)         { conditions.push(`l.city ILIKE $${p++}`);         params.push(`%${city}%`); }
  if (postalCode)   { conditions.push(`l.postal_code = $${p++}`);      params.push(postalCode); }
  if (propertyType) { conditions.push(`l.property_type = $${p++}`);    params.push(propertyType); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const activeResult = await query(
    `SELECT
       COUNT(*)                                          AS active_count,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY list_price) AS median_price,
       AVG(list_price)                                  AS avg_price,
       MIN(list_price)                                  AS min_price,
       MAX(list_price)                                  AS max_price,
       AVG(EXTRACT(DAY FROM NOW() - on_market_date))    AS avg_days_on_market
     FROM listings l ${where}`,
    params
  );

  // New listings in the lookback window
  const newListingsConds  = [...conditions, `l.on_market_date >= NOW() - $${p++}::interval`];
  const newListingsResult = await query(
    `SELECT COUNT(*) AS new_listings
     FROM listings l WHERE ${newListingsConds.join(' AND ')}`,
    [...params, `${lookbackDays} days`]
  );

  // Price changes in lookback window
  const priceChangeConds  = [...conditions.filter(c => !c.includes('mls_status')), `ph.event_type = 'price_change'`, `ph.event_date >= NOW() - $${p}::interval`];
  const priceChangeResult = await query(
    `SELECT COUNT(*) AS price_reductions
     FROM price_history ph
     JOIN listings l ON l.id = ph.listing_id
     WHERE ${priceChangeConds.join(' AND ')}`,
    [...params.slice(0, params.length), `${lookbackDays} days`]
  );

  const stats            = activeResult.rows[0];
  const newListingsRow   = newListingsConds  ? newListingsResult.rows[0]  : { new_listings: 0 };
  const priceChangeRow   = priceChangeResult.rows[0];

  return {
    active_count:    parseInt(stats.active_count, 10),
    median_price:    stats.median_price    ? parseFloat(stats.median_price)    : null,
    avg_price:       stats.avg_price       ? parseFloat(stats.avg_price)       : null,
    min_price:       stats.min_price       ? parseFloat(stats.min_price)       : null,
    max_price:       stats.max_price       ? parseFloat(stats.max_price)       : null,
    avg_days_on_market: stats.avg_days_on_market ? Math.round(parseFloat(stats.avg_days_on_market)) : null,
    new_listings_30d: parseInt(newListingsRow.new_listings, 10),
    price_reductions_30d: parseInt(priceChangeRow.price_reductions, 10),
  };
}

/**
 * Get or create a market snapshot narrative for a neighbourhood.
 * @param {string} slug  neighbourhood slug
 * @returns {Promise<object|null>}
 */
async function getNeighbourhoodSnapshot(slug) {
  const result = await query(
    `SELECT * FROM market_snapshots WHERE slug = $1 ORDER BY generated_at DESC LIMIT 1`,
    [slug]
  );
  return result.rows[0] || null;
}

/**
 * Save a freshly generated neighbourhood market narrative.
 * @param {string} slug
 * @param {string} narrative
 * @param {object} stats
 */
async function saveNeighbourhoodSnapshot(slug, narrative, stats) {
  await query(
    `INSERT INTO market_snapshots (slug, narrative, stats_json)
     VALUES ($1, $2, $3)`,
    [slug, narrative, JSON.stringify(stats)]
  );
}

module.exports = { getMarketStats, getNeighbourhoodSnapshot, saveNeighbourhoodSnapshot };
