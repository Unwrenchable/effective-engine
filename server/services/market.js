'use strict';

/**
 * Market statistics service.
 * Computes + caches market stats; generates AI narratives for neighbourhoods.
 */

const marketModel = require('../models/market');
const { generateMarketNarrative } = require('./ai');
const fs = require('fs');
const path = require('path');

// In-process cache: slug → {stats, narrative, cachedAt}
const _cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let _mockListings = null;

function loadMockListings() {
  if (_mockListings) return _mockListings;
  try {
    const seedFile = path.join(__dirname, '../../db/seed/listings.json');
    const parsed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    _mockListings = Array.isArray(parsed) ? parsed : [];
  } catch {
    _mockListings = [];
  }
  return _mockListings;
}

function computeFallbackStats(opts = {}) {
  const {
    city,
    postalCode,
    propertyType,
    lookbackDays = 30,
  } = opts;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const listings = loadMockListings().filter((l) => {
    if (String(l.MlsStatus || '').toLowerCase() !== 'active') return false;
    if (city && !String(l.City || '').toLowerCase().includes(String(city).toLowerCase())) return false;
    if (postalCode && String(l.PostalCode || '') !== String(postalCode)) return false;
    if (propertyType && String(l.PropertyType || '') !== String(propertyType)) return false;
    return true;
  });

  const prices = listings
    .map((l) => Number(l.ListPrice || 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const median = prices.length
    ? (prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
    : null;

  const avg = prices.length ? prices.reduce((sum, n) => sum + n, 0) / prices.length : null;
  const min = prices.length ? prices[0] : null;
  const max = prices.length ? prices[prices.length - 1] : null;

  const daysOnMarket = listings
    .map((l) => l.OnMarketDate ? Math.max(0, (now - Date.parse(l.OnMarketDate)) / dayMs) : null)
    .filter((n) => n != null && Number.isFinite(n));

  const avgDays = daysOnMarket.length
    ? Math.round(daysOnMarket.reduce((sum, n) => sum + n, 0) / daysOnMarket.length)
    : null;

  const lookbackMs = lookbackDays * dayMs;
  const newListings = listings.filter((l) => {
    if (!l.OnMarketDate) return false;
    const ts = Date.parse(l.OnMarketDate);
    return Number.isFinite(ts) && (now - ts) <= lookbackMs;
  }).length;

  const priceReductions = listings.filter((l) => {
    const list = Number(l.ListPrice || 0);
    const original = Number(l.OriginalListPrice || 0);
    return Number.isFinite(list) && Number.isFinite(original) && original > 0 && list < original;
  }).length;

  return {
    active_count: listings.length,
    median_price: median,
    avg_price: avg,
    min_price: min,
    max_price: max,
    avg_days_on_market: avgDays,
    new_listings_30d: newListings,
    price_reductions_30d: priceReductions,
  };
}

/**
 * Get market stats for an area.
 * @param {object} opts  {city?, postalCode?, propertyType?, lookbackDays?}
 * @returns {Promise<object>}
 */
async function getStats(opts = {}) {
  try {
    return await marketModel.getMarketStats(opts);
  } catch (err) {
    console.warn('[market] DB unavailable, using seeded fallback stats:', err.message);
    return computeFallbackStats(opts);
  }
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
  const stats       = await getStats({ city: displayName });

  // Try DB snapshot (< 1 hour old)
  let narrative = null;
  try {
    const snapshot = await marketModel.getNeighbourhoodSnapshot(slug);
    const oneHour  = 60 * 60 * 1000;
    if (snapshot && Date.now() - new Date(snapshot.generated_at).getTime() < oneHour) {
      narrative = snapshot.narrative;
    }
  } catch (err) {
    console.warn('[market] Snapshot unavailable:', err.message);
  }

  if (!narrative) {
    try {
      narrative = await generateMarketNarrative(displayName, stats);
      try {
        await marketModel.saveNeighbourhoodSnapshot(slug, narrative, stats);
      } catch (err) {
        console.warn('[market] Failed to save snapshot:', err.message);
      }
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
