'use strict';

/**
 * MLS data ingest / sync service.
 *
 * Performs:
 *  1. Full sync  — downloads all active GLVAR listings (run nightly)
 *  2. Delta sync — downloads only records modified since last sync (every 15 min)
 *
 * For each listing:
 *  - Upserts the listing record
 *  - Replaces media records
 *  - Records CDC events (new listing, price change, status change)
 *  - Queues AI enrichment jobs (embedding, description, photo tags)
 *
 * Run modes:
 *   node server/sync/ingest.js --once      (single delta sync then exit)
 *   node server/sync/ingest.js --full      (full sync then exit)
 *   imported by scheduler.js for scheduled runs
 */

const {
  fetchAllListings, mapResoToDb, extractMedia,
  ResoConfigError, ResoAuthError,
} = require('./reso-client');

const {
  upsertListing, replaceListingMedia, recordCdcEvent, updateAiFields,
} = require('../models/listing');

const { buildAttribution } = require('../services/compliance');
const { generateEmbedding, generateListingDescription, analyzePhoto, buildListingText } = require('../services/ai');
const { query } = require('../models/db');

// Track last sync timestamp in DB
const SYNC_STATE_KEY = 'last_delta_sync';

// ─── State management ─────────────────────────────────────────────────────────

async function getLastSyncTime() {
  const result = await query(
    `SELECT value FROM sync_state WHERE key = $1`,
    [SYNC_STATE_KEY]
  );
  return result.rows[0]?.value || null;
}

async function setLastSyncTime(iso) {
  await query(
    `INSERT INTO sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SYNC_STATE_KEY, iso]
  );
}

// ─── Batch processing ─────────────────────────────────────────────────────────

/**
 * Process a batch of raw RESO listing records.
 * @param {object[]} rawListings
 * @param {object}   stats  mutable counters: {upserted, new, priceChanges, statusChanges}
 */
async function processBatch(rawListings, stats) {
  for (const raw of rawListings) {
    try {
      const attr = buildAttribution({
        list_office_name:     raw.ListOfficeName,
        list_agent_full_name: raw.ListAgentFullName,
        listing_id:           raw.ListingId,
      });

      const dbRow    = mapResoToDb(raw, attr.courtesyOf, attr.mlsDisclaimer);
      const result   = await upsertListing(dbRow);

      if (!result) continue;

      const { id: internalId, is_new: isNew } = result;
      stats.upserted++;

      // CDC events
      if (isNew) {
        stats.new++;
        await recordCdcEvent(raw.ListingId, 'new_listing', {
          list_price:    raw.ListPrice,
          mls_status:    raw.MlsStatus,
          on_market_date: raw.OnMarketDate,
        });
      } else {
        // Detect price/status change by comparing with what we had
        // (For simplicity, we record if a price_history entry doesn't exist yet)
        await maybeRecordChanges(internalId, raw, stats);
      }

      // Media
      const media = extractMedia(raw);
      if (media.length) {
        await replaceListingMedia(internalId, media);
      }

      // Queue AI enrichment (non-blocking, best-effort)
      enrichAsync(internalId, dbRow, media).catch((err) => {
        console.warn(`[ingest] AI enrichment failed for ${raw.ListingId}:`, err.message);
      });

    } catch (err) {
      console.error(`[ingest] Failed to process ${raw.ListingId}:`, err.message);
    }
  }
}

async function maybeRecordChanges(internalId, raw, stats) {
  // Check existing price history for this listing
  const last = await query(
    `SELECT price, event_type FROM price_history WHERE listing_id = $1
     ORDER BY event_date DESC LIMIT 1`,
    [internalId]
  );

  const lastRow = last.rows[0];

  if (lastRow && lastRow.price !== raw.ListPrice && raw.ListPrice) {
    await query(
      `INSERT INTO price_history (listing_id, price, event_type, event_date)
       VALUES ($1, $2, 'price_change', NOW()) ON CONFLICT DO NOTHING`,
      [internalId, raw.ListPrice]
    );
    await recordCdcEvent(raw.ListingId, 'price_change', {
      old_price: lastRow.price,
      new_price: raw.ListPrice,
    });
    stats.priceChanges++;
  }

  if (lastRow && lastRow.event_type !== raw.MlsStatus && raw.MlsStatus === 'Closed') {
    await query(
      `INSERT INTO price_history (listing_id, price, event_type, event_date)
       VALUES ($1, $2, 'sold', NOW()) ON CONFLICT DO NOTHING`,
      [internalId, raw.ClosePrice || raw.ListPrice]
    );
    await recordCdcEvent(raw.ListingId, 'sold', { close_price: raw.ClosePrice });
  }
}

// ─── AI enrichment ────────────────────────────────────────────────────────────

/**
 * Enrich a listing with AI-generated fields asynchronously.
 * - Generate description if public_remarks is short/absent
 * - Generate embedding for semantic search
 * - Analyze primary photo for feature tags
 *
 * @param {number} internalId
 * @param {object} dbRow
 * @param {object[]} media
 */
async function enrichAsync(internalId, dbRow, media) {
  const updates = {};

  // Description
  const remarks = dbRow.public_remarks || '';
  if (remarks.length < 100) {
    try {
      updates.ai_description = await generateListingDescription(dbRow);
    } catch (err) {
      console.warn(`[ingest/ai] Description generation failed for ${dbRow.listing_id}:`, err.message);
    }
  }

  // Photo tags (from first photo)
  const primaryPhoto = media.find((m) => m.mediaType === 'photo');
  if (primaryPhoto?.url) {
    try {
      updates.ai_photo_tags = await analyzePhoto(primaryPhoto.url);
    } catch (err) {
      console.warn(`[ingest/ai] Photo analysis failed for ${dbRow.listing_id}:`, err.message);
    }
  }

  // Embedding (use AI description if available, else public_remarks)
  const textForEmbedding = updates.ai_description || dbRow.public_remarks;
  if (textForEmbedding) {
    try {
      const enrichedListing = { ...dbRow, ...updates };
      const fullText = buildListingText(enrichedListing);
      updates.description_embedding = await generateEmbedding(fullText);
    } catch (err) {
      console.warn(`[ingest/ai] Embedding generation failed for ${dbRow.listing_id}:`, err.message);
    }
  }

  if (Object.keys(updates).length) {
    await updateAiFields(internalId, updates);
  }
}

// ─── Public sync functions ────────────────────────────────────────────────────

/**
 * Run an incremental (delta) sync: only fetch listings modified since last run.
 * @returns {Promise<object>}  sync stats
 */
async function deltaSync() {
  const startTime    = new Date().toISOString();
  const lastSyncTime = await getLastSyncTime();

  console.log(`[ingest] Delta sync start. Last sync: ${lastSyncTime || 'never (will do full)'}`);

  const stats = { upserted: 0, new: 0, priceChanges: 0, statusChanges: 0, pages: 0 };

  const { total, pages } = await fetchAllListings(lastSyncTime, async (batch) => {
    await processBatch(batch, stats);
    stats.pages++;
    process.stdout.write('.');
  });

  console.log(`\n[ingest] Delta sync complete. ${total} listings, ${pages} pages. Stats:`, stats);

  await setLastSyncTime(startTime);
  return { ...stats, total, pages, type: 'delta', completedAt: new Date().toISOString() };
}

/**
 * Run a full sync: re-fetch all active listings regardless of modification time.
 * @returns {Promise<object>}  sync stats
 */
async function fullSync() {
  const startTime = new Date().toISOString();

  console.log('[ingest] Full sync start — this may take several minutes.');

  const stats = { upserted: 0, new: 0, priceChanges: 0, statusChanges: 0, pages: 0 };

  const { total, pages } = await fetchAllListings(null, async (batch) => {
    await processBatch(batch, stats);
    stats.pages++;
    process.stdout.write('.');
  });

  console.log(`\n[ingest] Full sync complete. ${total} listings, ${pages} pages. Stats:`, stats);

  // Mark the start of this full sync as the baseline for future delta syncs
  await setLastSyncTime(startTime);
  return { ...stats, total, pages, type: 'full', completedAt: new Date().toISOString() };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const fn   = args.includes('--full') ? fullSync : deltaSync;

  fn()
    .then((result) => {
      console.log('[ingest] Done:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { deltaSync, fullSync };
