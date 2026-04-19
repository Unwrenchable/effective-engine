'use strict';

const { query, transaction } = require('./db');

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Search listings using structured filters plus optional semantic vector search.
 *
 * @param {object} opts
 * @param {string}  [opts.location]
 * @param {number}  [opts.minPrice]
 * @param {number}  [opts.maxPrice]
 * @param {number}  [opts.minBeds]
 * @param {number}  [opts.minBaths]
 * @param {string}  [opts.propertyType]
 * @param {string}  [opts.propertySubType]
 * @param {string}  [opts.status]           default 'Active'
 * @param {number}  [opts.lat]              geo center
 * @param {number}  [opts.lng]
 * @param {number}  [opts.radiusMiles]      default 10
 * @param {number[]} [opts.embedding]       1536-dim vector for semantic search
 * @param {string}  [opts.sort]             'price-asc'|'price-desc'|'newest'|'relevant'
 * @param {number}  [opts.page]             1-based
 * @param {number}  [opts.pageSize]
 * @returns {Promise<{listings: object[], total: number}>}
 */
async function searchListings(opts = {}) {
  const {
    location, minPrice, maxPrice, minBeds, minBaths,
    propertyType, propertySubType,
    status = 'Active',
    lat, lng, radiusMiles = 10,
    embedding,
    sort = 'newest',
    page = 1,
    pageSize = 12,
  } = opts;

  const conditions = [];
  const params     = [];
  let   p          = 1;

  conditions.push(`l.mls_status = $${p++}`);
  params.push(status);

  if (minPrice)  { conditions.push(`l.list_price >= $${p++}`);   params.push(minPrice); }
  if (maxPrice)  { conditions.push(`l.list_price <= $${p++}`);   params.push(maxPrice); }
  if (minBeds)   { conditions.push(`l.bedrooms_total >= $${p++}`); params.push(minBeds); }
  if (minBaths)  { conditions.push(`l.bathrooms_total >= $${p++}`); params.push(minBaths); }
  if (propertyType)    { conditions.push(`l.property_type = $${p++}`);     params.push(propertyType); }
  if (propertySubType) { conditions.push(`l.property_sub_type = $${p++}`); params.push(propertySubType); }

  if (location) {
    conditions.push(
      `(l.city ILIKE $${p} OR l.postal_code = $${p} OR l.subdivision_name ILIKE $${p})`
    );
    params.push(`%${location}%`);
    p++;
  }

  // Geo-distance filter (PostGIS)
  let distanceSelect = '';
  if (lat != null && lng != null) {
    conditions.push(
      `ST_DWithin(l.location::geography, ST_MakePoint($${p++}, $${p++})::geography, $${p++})`
    );
    params.push(lng, lat, radiusMiles * 1609.34);
    distanceSelect = `, ST_Distance(l.location::geography, ST_MakePoint($${p++}, $${p++})::geography) / 1609.34 AS distance_miles`;
    params.push(lng, lat);
  }

  // Semantic similarity score
  let vectorSelect = '';
  if (embedding) {
    vectorSelect = `, 1 - (l.description_embedding <=> $${p++}::vector) AS similarity`;
    params.push(JSON.stringify(embedding));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderBy = {
    'price-asc':  'l.list_price ASC',
    'price-desc': 'l.list_price DESC',
    'newest':     'l.on_market_date DESC NULLS LAST, l.modification_timestamp DESC',
    'relevant':   embedding ? 'similarity DESC' : 'l.modification_timestamp DESC',
  }[sort] || 'l.modification_timestamp DESC';

  const offset = (page - 1) * pageSize;

  const sql = `
    SELECT
      l.id, l.listing_id, l.mls_status, l.list_price, l.original_list_price,
      l.street_number, l.street_name, l.unit_number,
      l.city, l.state_or_province, l.postal_code,
      l.latitude, l.longitude,
      l.bedrooms_total, l.bathrooms_total, l.bathrooms_full, l.bathrooms_half,
      l.living_area, l.lot_size_sqft,
      l.property_type, l.property_sub_type,
      l.year_built, l.garage_spaces,
      l.pool_yn, l.spa_yn, l.view_yn, l.view_description,
      l.hoa_fee, l.hoa_fee_frequency,
      l.list_office_name, l.list_agent_full_name,
      l.on_market_date, l.modification_timestamp,
      l.public_remarks, l.ai_description,
      l.ai_photo_tags,
      l.idx_display_allowed,
      l.attribution_courtesy_of, l.attribution_disclaimer,
      (SELECT json_agg(json_build_object('url', m.cdn_url, 'order', m.media_order))
         FROM listing_media m WHERE m.listing_id = l.id AND m.media_type = 'photo'
         ORDER BY m.media_order LIMIT 25) AS photos
      ${vectorSelect}
      ${distanceSelect}
    FROM listings l
    ${where}
    ORDER BY ${orderBy}
    LIMIT $${p++} OFFSET $${p++}
  `;
  params.push(pageSize, offset);

  const countSql = `SELECT COUNT(*) FROM listings l ${where}`;

  // Count uses the same params except the last two (LIMIT/OFFSET)
  const [dataResult, countResult] = await Promise.all([
    query(sql, params),
    query(countSql, params.slice(0, params.length - 2)),
  ]);

  return {
    listings: dataResult.rows,
    total:    parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Get a single listing by its MLS ListingId.
 * @param {string} listingId
 * @returns {Promise<object|null>}
 */
async function getListingById(listingId) {
  const result = await query(
    `SELECT
       l.*,
       (SELECT json_agg(json_build_object(
         'url', m.cdn_url, 'order', m.media_order, 'caption', m.caption
       ) ORDER BY m.media_order)
        FROM listing_media m WHERE m.listing_id = l.id) AS media,
       (SELECT json_agg(json_build_object(
         'date', oh.open_house_date, 'start', oh.start_time, 'end', oh.end_time
       ))
        FROM open_houses oh WHERE oh.listing_id = l.id AND oh.open_house_date >= CURRENT_DATE) AS open_houses,
       (SELECT json_agg(json_build_object(
         'date', ph.event_date, 'price', ph.price, 'event', ph.event_type
       ) ORDER BY ph.event_date DESC)
        FROM price_history ph WHERE ph.listing_id = l.id) AS price_history
     FROM listings l
     WHERE l.listing_id = $1`,
    [listingId]
  );
  return result.rows[0] || null;
}

/**
 * Find listings similar to the given one by vector + structured fields.
 * @param {string} listingId
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
async function getSimilarListings(listingId, limit = 6) {
  const result = await query(
    `SELECT
       s.id, s.listing_id, s.mls_status, s.list_price,
       s.street_number, s.street_name, s.city, s.state_or_province, s.postal_code,
       s.bedrooms_total, s.bathrooms_total, s.living_area,
       s.property_type, s.property_sub_type,
       s.list_office_name, s.list_agent_full_name,
       s.on_market_date,
       s.ai_photo_tags,
       s.attribution_courtesy_of, s.attribution_disclaimer,
       1 - (s.description_embedding <=> src.description_embedding) AS similarity,
       (SELECT m.cdn_url FROM listing_media m
        WHERE m.listing_id = s.id AND m.media_type = 'photo'
        ORDER BY m.media_order LIMIT 1) AS primary_photo
     FROM listings src, listings s
     WHERE src.listing_id = $1
       AND s.listing_id  != $1
       AND s.mls_status   = 'Active'
       AND s.idx_display_allowed IS NOT FALSE
       AND s.description_embedding IS NOT NULL
     ORDER BY s.description_embedding <=> src.description_embedding
     LIMIT $2`,
    [listingId, limit]
  );
  return result.rows;
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Upsert a listing record from the MLS feed.
 * Uses listing_id (MLS#) as the conflict key.
 * @param {object} data   Normalised listing fields
 * @returns {Promise<{id: number, listing_id: string, is_new: boolean}>}
 */
async function upsertListing(data) {
  const {
    listing_id, mls_status, list_price, original_list_price,
    street_number, street_name, unit_number,
    city, state_or_province, postal_code, county,
    latitude, longitude,
    bedrooms_total, bathrooms_total, bathrooms_full, bathrooms_half,
    living_area, lot_size_sqft, lot_size_acres,
    property_type, property_sub_type, year_built, garage_spaces,
    pool_yn, spa_yn, view_yn, view_description,
    hoa_fee, hoa_fee_frequency,
    list_office_name, list_agent_full_name,
    listing_contract_date, on_market_date, modification_timestamp,
    public_remarks,
    community_features, interior_features, exterior_features,
    heating, cooling, fireplace_yn, fireplaces_total,
    laundry_features, parking_features, roof, foundation_details,
    idx_display_allowed,
    attribution_courtesy_of, attribution_disclaimer,
  } = data;

  const result = await query(
    `INSERT INTO listings (
       listing_id, mls_status, list_price, original_list_price,
       street_number, street_name, unit_number,
       city, state_or_province, postal_code, county,
       latitude, longitude,
       location,
       bedrooms_total, bathrooms_total, bathrooms_full, bathrooms_half,
       living_area, lot_size_sqft, lot_size_acres,
       property_type, property_sub_type, year_built, garage_spaces,
       pool_yn, spa_yn, view_yn, view_description,
       hoa_fee, hoa_fee_frequency,
       list_office_name, list_agent_full_name,
       listing_contract_date, on_market_date, modification_timestamp,
       public_remarks,
       community_features, interior_features, exterior_features,
       heating, cooling, fireplace_yn, fireplaces_total,
       laundry_features, parking_features, roof, foundation_details,
       idx_display_allowed,
       attribution_courtesy_of, attribution_disclaimer,
       synced_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       CASE WHEN $12 IS NOT NULL AND $13 IS NOT NULL
            THEN ST_MakePoint($13, $12)
            ELSE NULL END,
       $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
       $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,
       NOW()
     )
     ON CONFLICT (listing_id) DO UPDATE SET
       mls_status             = EXCLUDED.mls_status,
       list_price             = EXCLUDED.list_price,
       original_list_price    = EXCLUDED.original_list_price,
       street_number          = EXCLUDED.street_number,
       street_name            = EXCLUDED.street_name,
       unit_number            = EXCLUDED.unit_number,
       city                   = EXCLUDED.city,
       state_or_province      = EXCLUDED.state_or_province,
       postal_code            = EXCLUDED.postal_code,
       county                 = EXCLUDED.county,
       latitude               = EXCLUDED.latitude,
       longitude              = EXCLUDED.longitude,
       location               = EXCLUDED.location,
       bedrooms_total         = EXCLUDED.bedrooms_total,
       bathrooms_total        = EXCLUDED.bathrooms_total,
       bathrooms_full         = EXCLUDED.bathrooms_full,
       bathrooms_half         = EXCLUDED.bathrooms_half,
       living_area            = EXCLUDED.living_area,
       lot_size_sqft          = EXCLUDED.lot_size_sqft,
       lot_size_acres         = EXCLUDED.lot_size_acres,
       property_type          = EXCLUDED.property_type,
       property_sub_type      = EXCLUDED.property_sub_type,
       year_built             = EXCLUDED.year_built,
       garage_spaces          = EXCLUDED.garage_spaces,
       pool_yn                = EXCLUDED.pool_yn,
       spa_yn                 = EXCLUDED.spa_yn,
       view_yn                = EXCLUDED.view_yn,
       view_description       = EXCLUDED.view_description,
       hoa_fee                = EXCLUDED.hoa_fee,
       hoa_fee_frequency      = EXCLUDED.hoa_fee_frequency,
       list_office_name       = EXCLUDED.list_office_name,
       list_agent_full_name   = EXCLUDED.list_agent_full_name,
       listing_contract_date  = EXCLUDED.listing_contract_date,
       on_market_date         = EXCLUDED.on_market_date,
       modification_timestamp = EXCLUDED.modification_timestamp,
       public_remarks         = EXCLUDED.public_remarks,
       community_features     = EXCLUDED.community_features,
       interior_features      = EXCLUDED.interior_features,
       exterior_features      = EXCLUDED.exterior_features,
       heating                = EXCLUDED.heating,
       cooling                = EXCLUDED.cooling,
       fireplace_yn           = EXCLUDED.fireplace_yn,
       fireplaces_total       = EXCLUDED.fireplaces_total,
       laundry_features       = EXCLUDED.laundry_features,
       parking_features       = EXCLUDED.parking_features,
       roof                   = EXCLUDED.roof,
       foundation_details     = EXCLUDED.foundation_details,
       idx_display_allowed    = EXCLUDED.idx_display_allowed,
       attribution_courtesy_of  = EXCLUDED.attribution_courtesy_of,
       attribution_disclaimer   = EXCLUDED.attribution_disclaimer,
       synced_at              = NOW()
     RETURNING id, listing_id, (xmax = 0) AS is_new`,
    [
      listing_id, mls_status, list_price, original_list_price,
      street_number, street_name, unit_number,
      city, state_or_province, postal_code, county,
      latitude, longitude,
      bedrooms_total, bathrooms_total, bathrooms_full, bathrooms_half,
      living_area, lot_size_sqft, lot_size_acres,
      property_type, property_sub_type, year_built, garage_spaces,
      pool_yn, spa_yn, view_yn, view_description,
      hoa_fee, hoa_fee_frequency,
      list_office_name, list_agent_full_name,
      listing_contract_date, on_market_date, modification_timestamp,
      public_remarks,
      community_features, interior_features, exterior_features,
      heating, cooling, fireplace_yn, fireplaces_total,
      laundry_features, parking_features, roof, foundation_details,
      idx_display_allowed,
      attribution_courtesy_of, attribution_disclaimer,
    ]
  );
  return result.rows[0];
}

/**
 * Update AI-generated fields on a listing.
 * @param {number} id         internal listing PK
 * @param {object} aiData
 * @param {string}   [aiData.ai_description]
 * @param {number[]} [aiData.description_embedding]
 * @param {string[]} [aiData.ai_photo_tags]
 */
async function updateAiFields(id, { ai_description, description_embedding, ai_photo_tags }) {
  const sets   = [];
  const params = [];
  let   p      = 1;

  if (ai_description    != null) { sets.push(`ai_description = $${p++}`);        params.push(ai_description); }
  if (description_embedding != null) { sets.push(`description_embedding = $${p++}::vector`); params.push(JSON.stringify(description_embedding)); }
  if (ai_photo_tags     != null) { sets.push(`ai_photo_tags = $${p++}`);          params.push(JSON.stringify(ai_photo_tags)); }

  if (!sets.length) return;
  params.push(id);
  await query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $${p}`, params);
}

/**
 * Record a CDC (change data capture) event.
 * @param {string} listingId
 * @param {string} eventType  'new_listing'|'price_change'|'status_change'|'expired'
 * @param {object} [details]
 */
async function recordCdcEvent(listingId, eventType, details = {}) {
  await query(
    `INSERT INTO cdc_log (listing_id, event_type, details) VALUES ($1, $2, $3)`,
    [listingId, eventType, JSON.stringify(details)]
  );
}

/**
 * Upsert listing media (photos, videos).
 * Deletes existing media for the listing and inserts fresh records.
 * @param {number}   listingInternalId
 * @param {object[]} mediaItems  [{url, cdnUrl, mediaType, order, caption}]
 */
async function replaceListingMedia(listingInternalId, mediaItems) {
  await transaction(async (client) => {
    await client.query('DELETE FROM listing_media WHERE listing_id = $1', [listingInternalId]);
    for (const item of mediaItems) {
      await client.query(
        `INSERT INTO listing_media (listing_id, original_url, cdn_url, media_type, media_order, caption)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [listingInternalId, item.url, item.cdnUrl || item.url, item.mediaType || 'photo', item.order ?? 0, item.caption ?? null]
      );
    }
  });
}

module.exports = {
  searchListings, getListingById, getSimilarListings,
  upsertListing, updateAiFields, recordCdcEvent, replaceListingMedia,
};
