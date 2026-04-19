'use strict';

/**
 * Basic Automated Valuation Model (AVM).
 *
 * Produces an estimated value for a property from comparable active/sold listings.
 * This is a comparable-sales (hedonic) approach — no ML model training required.
 * Upgrade path: replace with an XGBoost or neural net model once sufficient
 * historical sold data has accumulated (typically 6+ months).
 *
 * Formula: weighted average of comp adjusted prices, where weight = 1 / distance²
 */

const { query } = require('../models/db');

const MAX_COMPS = 10;

/**
 * Estimate the market value of a listing.
 *
 * @param {object} listing  must include: listing_id, city, living_area,
 *                          bedrooms_total, bathrooms_total, latitude, longitude
 * @returns {Promise<{estimate:number|null, confidence:'high'|'medium'|'low', comps:object[]}>}
 */
async function estimate(listing) {
  const {
    listing_id,
    city,
    living_area,
    bedrooms_total,
    bathrooms_total,
    latitude,
    longitude,
    property_type,
  } = listing;

  if (!living_area || !city) {
    return { estimate: null, confidence: 'low', comps: [] };
  }

  // Find comparable sold listings in the last 6 months within 2 miles
  const result = await query(
    `SELECT
       l.listing_id,
       l.list_price,
       l.living_area,
       l.bedrooms_total,
       l.bathrooms_total,
       ST_Distance(l.location::geography, ST_MakePoint($1, $2)::geography) / 1609.34 AS distance_miles,
       ph.price AS sold_price,
       ph.event_date AS sold_date
     FROM listings l
     JOIN price_history ph ON ph.listing_id = l.id AND ph.event_type = 'sold'
     WHERE l.listing_id     != $3
       AND l.city ILIKE $4
       AND l.property_type  = $5
       AND l.living_area    BETWEEN $6 AND $7
       AND ph.event_date    >= NOW() - INTERVAL '6 months'
       AND l.location IS NOT NULL
       AND ST_DWithin(l.location::geography, ST_MakePoint($1, $2)::geography, 3218.69)
     ORDER BY distance_miles ASC
     LIMIT $8`,
    [
      longitude ?? 0, latitude ?? 0,
      listing_id,
      `%${city}%`,
      property_type || 'Residential',
      Math.round(living_area * 0.7),
      Math.round(living_area * 1.3),
      MAX_COMPS,
    ]
  );

  const comps = result.rows;
  if (comps.length < 3) {
    return { estimate: null, confidence: 'low', comps };
  }

  // Calculate price per sqft for each comp and adjust
  const weightedValues = comps.map((comp) => {
    const pricePerSqft = (comp.sold_price || comp.list_price) / comp.living_area;
    const adjustedValue = pricePerSqft * living_area;

    // Bedroom/bath adjustment: $10k per bed diff, $8k per bath diff
    const bedAdj  = (bedrooms_total  - (comp.bedrooms_total  ?? bedrooms_total))  * 10_000;
    const bathAdj = (bathrooms_total - (comp.bathrooms_total ?? bathrooms_total)) *  8_000;

    const adjusted = adjustedValue + bedAdj + bathAdj;
    const dist     = Math.max(comp.distance_miles, 0.01);
    const weight   = 1 / (dist * dist);

    return { adjusted, weight, comp };
  });

  const totalWeight    = weightedValues.reduce((s, v) => s + v.weight, 0);
  const weightedSum    = weightedValues.reduce((s, v) => s + v.adjusted * v.weight, 0);
  const estimate       = Math.round(weightedSum / totalWeight / 1000) * 1000; // round to nearest $1k

  const confidence = comps.length >= 7 ? 'high' : comps.length >= 4 ? 'medium' : 'low';

  return {
    estimate,
    confidence,
    comps: comps.slice(0, 5).map((c) => ({
      listing_id:  c.listing_id,
      sold_price:  c.sold_price || c.list_price,
      sold_date:   c.sold_date,
      living_area: c.living_area,
      distance_miles: parseFloat(c.distance_miles.toFixed(2)),
    })),
  };
}

module.exports = { estimate };
