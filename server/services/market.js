'use strict';

/**
 * Market statistics service.
 * Computes + caches market stats; generates AI narratives for neighbourhoods.
 */

const marketModel = require('../models/market');
const { generateMarketNarrative } = require('./ai');

// In-process cache: slug → {stats, narrative, cachedAt}
const _cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get market stats for an area.
 * @param {object} opts  {city?, postalCode?, propertyType?, lookbackDays?}
 * @returns {Promise<object>}
 */
async function getStats(opts = {}) {
  return marketModel.getMarketStats(opts);
}

/**
 * Get neighbourhood profile with market stats + AI narrative.
 * Caches the result for 30 minutes in memory;
 * persists snapshots to the DB for historical tracking.
 *
 * @param {string} slug  e.g. 'summerlin', 'henderson', 'green-valley'
 * @returns {Promise<{slug, displayName, stats, narrative, generatedAt}>}
 */
async function getNeighbourhoodProfile(slug) {
  const cached = _cache.get(slug);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const displayName = slugToDisplayName(slug);
  const stats       = await marketModel.getMarketStats({ city: displayName });

  // Try DB snapshot (< 1 hour old)
  let narrative = null;
  const snapshot = await marketModel.getNeighbourhoodSnapshot(slug);
  const oneHour  = 60 * 60 * 1000;
  if (snapshot && Date.now() - new Date(snapshot.generated_at).getTime() < oneHour) {
    narrative = snapshot.narrative;
  }

  if (!narrative) {
    try {
      narrative = await generateMarketNarrative(displayName, stats);
      await marketModel.saveNeighbourhoodSnapshot(slug, narrative, stats);
    } catch (err) {
      console.warn('[market] AI narrative unavailable:', err.message);
      narrative = buildFallbackNarrative(displayName, stats);
    }
  }

  const data = {
    slug,
    displayName,
    stats,
    narrative,
    generatedAt: new Date().toISOString(),
  };

  _cache.set(slug, { data, cachedAt: Date.now() });
  return data;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugToDisplayName(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildFallbackNarrative(name, stats) {
  const parts = [`${name} currently has ${stats.active_count ?? 0} active listings.`];
  if (stats.median_price) {
    parts.push(`Median list price is $${Math.round(stats.median_price).toLocaleString()}.`);
  }
  if (stats.avg_days_on_market != null) {
    parts.push(`Properties are averaging ${stats.avg_days_on_market} days on market.`);
  }
  return parts.join(' ');
}

module.exports = { getStats, getNeighbourhoodProfile };
