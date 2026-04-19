'use strict';

/**
 * OpenAI integration service.
 *
 * Provides:
 *  - generateEmbedding()       — 1536-dim vector for semantic search
 *  - generateListingDescription() — AI-written listing description
 *  - generateMarketNarrative()    — neighbourhood market summary
 *  - analyzePhotos()              — feature tags from listing photos
 *  - chatAnswer()                 — conversational listing assistant
 */

const config = require('../config');

let _openai = null;

function getOpenAI() {
  if (_openai) return _openai;
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. AI features are unavailable.');
  }
  const { OpenAI } = require('openai');
  _openai = new OpenAI({ apiKey: config.openai.apiKey });
  return _openai;
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

/**
 * Generate a text embedding vector.
 * @param {string} text
 * @returns {Promise<number[]>}  1536-dimensional array
 */
async function generateEmbedding(text) {
  const openai = getOpenAI();
  const resp   = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.slice(0, 8192),  // cap to model max tokens
  });
  return resp.data[0].embedding;
}

/**
 * Build a text corpus from a listing object suitable for embedding.
 * @param {object} listing
 * @returns {string}
 */
function buildListingText(listing) {
  const parts = [
    listing.public_remarks || listing.ai_description || '',
    listing.property_type           ? `Type: ${listing.property_type}` : '',
    listing.property_sub_type       ? `Sub-type: ${listing.property_sub_type}` : '',
    listing.bedrooms_total          ? `${listing.bedrooms_total} bedrooms` : '',
    listing.bathrooms_total         ? `${listing.bathrooms_total} bathrooms` : '',
    listing.living_area             ? `${listing.living_area} sq ft` : '',
    listing.year_built              ? `Built ${listing.year_built}` : '',
    listing.city                    ? `City: ${listing.city}` : '',
    listing.subdivision_name        ? `Community: ${listing.subdivision_name}` : '',
    listing.pool_yn                 ? 'Pool' : '',
    listing.spa_yn                  ? 'Spa' : '',
    listing.view_yn && listing.view_description ? `View: ${listing.view_description}` : '',
    listing.community_features || '',
    listing.interior_features  || '',
    listing.exterior_features  || '',
    Array.isArray(listing.ai_photo_tags) ? listing.ai_photo_tags.join(', ') : '',
  ];
  return parts.filter(Boolean).join('. ');
}

// ─── Description generation ──────────────────────────────────────────────────

/**
 * Generate a luxury real-estate listing description from structured fields.
 * Used when MLS remarks are absent or weak (< 100 chars).
 *
 * @param {object} listing
 * @returns {Promise<string>}
 */
async function generateListingDescription(listing) {
  const openai = getOpenAI();

  const prompt = `You are a luxury real estate copywriter for the Las Vegas Valley market.
Write a compelling, 3–4 paragraph property description (200–350 words) based on these details.
Tone: aspirational, elegant, specific. No made-up facts.

Property details:
- Address: ${[listing.street_number, listing.street_name, listing.unit_number].filter(Boolean).join(' ')}, ${listing.city}, NV ${listing.postal_code || ''}
- Type: ${listing.property_type || ''} ${listing.property_sub_type ? '– ' + listing.property_sub_type : ''}
- Bedrooms: ${listing.bedrooms_total || 'N/A'}, Bathrooms: ${listing.bathrooms_total || 'N/A'}
- Size: ${listing.living_area ? listing.living_area.toLocaleString() + ' sq ft' : 'N/A'} ${listing.lot_size_sqft ? '| Lot: ' + Math.round(listing.lot_size_sqft).toLocaleString() + ' sq ft' : ''}
- Year Built: ${listing.year_built || 'N/A'}
- Garage Spaces: ${listing.garage_spaces || 'N/A'}
- Pool: ${listing.pool_yn ? 'Yes' : 'No'} | Spa: ${listing.spa_yn ? 'Yes' : 'No'}
- View: ${listing.view_description || (listing.view_yn ? 'Yes' : 'No')}
- HOA: ${listing.hoa_fee ? '$' + listing.hoa_fee + '/' + (listing.hoa_fee_frequency || 'mo') : 'None'}
- Community features: ${listing.community_features || 'N/A'}
- Interior features: ${listing.interior_features || 'N/A'}
- Exterior features: ${listing.exterior_features || 'N/A'}
- MLS remarks: ${listing.public_remarks || 'None provided'}
- AI photo tags: ${Array.isArray(listing.ai_photo_tags) ? listing.ai_photo_tags.join(', ') : 'N/A'}

Write only the description. Do not include headings or bullet points.`;

  const resp = await openai.chat.completions.create({
    model:       config.openai.chatModel,
    messages:    [{ role: 'user', content: prompt }],
    max_tokens:  500,
    temperature: 0.7,
  });

  return resp.choices[0].message.content.trim();
}

// ─── Market narrative ────────────────────────────────────────────────────────

/**
 * Generate a human-readable market narrative for a neighbourhood.
 *
 * @param {string} neighbourhood   display name, e.g. "Summerlin"
 * @param {object} stats           from market model getMarketStats()
 * @returns {Promise<string>}
 */
async function generateMarketNarrative(neighbourhood, stats) {
  const openai = getOpenAI();

  const fmt = (n) => n != null ? n.toLocaleString() : 'N/A';
  const usd = (n) => n != null ? '$' + Math.round(n).toLocaleString() : 'N/A';

  const prompt = `You are a luxury real estate market analyst for the Las Vegas Valley.
Write a concise 2–3 sentence market narrative for ${neighbourhood} based on the following statistics.
Tone: professional, data-driven, informative. Use exact numbers.

Statistics (last 30 days):
- Active listings: ${fmt(stats.active_count)}
- Median list price: ${usd(stats.median_price)}
- Average list price: ${usd(stats.avg_price)}
- New listings (30d): ${fmt(stats.new_listings_30d)}
- Price reductions (30d): ${fmt(stats.price_reductions_30d)}
- Average days on market: ${stats.avg_days_on_market != null ? stats.avg_days_on_market + ' days' : 'N/A'}

Write only the narrative. No headings.`;

  const resp = await openai.chat.completions.create({
    model:       config.openai.chatModel,
    messages:    [{ role: 'user', content: prompt }],
    max_tokens:  200,
    temperature: 0.5,
  });

  return resp.choices[0].message.content.trim();
}

// ─── Photo analysis ──────────────────────────────────────────────────────────

/**
 * Analyse a listing photo and return feature tags.
 * Uses GPT-4o vision.
 *
 * @param {string} imageUrl  publicly accessible image URL
 * @returns {Promise<string[]>}  e.g. ['pool','open-concept kitchen','mountain view']
 */
async function analyzePhoto(imageUrl) {
  const openai = getOpenAI();

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'List the notable real estate features visible in this photo as a JSON array of short tags (e.g. ["pool","granite countertops","mountain view","open floor plan"]). Return only the JSON array, no other text.',
          },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      },
    ],
    max_tokens: 150,
  });

  const content = resp.choices[0].message.content.trim();
  try {
    const tags = JSON.parse(content);
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch {
    // Fallback: extract quoted strings
    const matches = content.match(/"([^"]+)"/g) || [];
    return matches.map((m) => m.replace(/"/g, ''));
  }
}

// ─── Listing chatbot ─────────────────────────────────────────────────────────

/**
 * Answer a buyer question about a specific listing using GPT-4.
 *
 * @param {object} listing    compliance-filtered listing object
 * @param {object[]} history  [{role:'user'|'assistant', content:string}]
 * @param {string} question   new user question
 * @returns {Promise<string>}
 */
async function chatAnswer(listing, history, question) {
  const openai = getOpenAI();

  const systemPrompt = `You are a knowledgeable, friendly real estate assistant for the luxury Las Vegas Valley market.
Answer questions about this listing concisely and helpfully.
If a question falls outside the listing details, say you don't know and suggest contacting the listing agent.
Never invent information not present in the listing details.

Listing details:
${buildListingText(listing)}
Address: ${[listing.street_number, listing.street_name, listing.unit_number].filter(Boolean).join(' ')}, ${listing.city || ''}, NV
List Price: $${listing.list_price ? listing.list_price.toLocaleString() : 'N/A'}
MLS#: ${listing.listing_id || ''}
Listing Agent: ${listing.list_agent_full_name || 'See office'}
Listing Office: ${listing.list_office_name || 'N/A'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),  // keep last 10 turns for context
    { role: 'user', content: question },
  ];

  const resp = await openai.chat.completions.create({
    model:       'gpt-4o-mini',
    messages,
    max_tokens:  400,
    temperature: 0.3,
  });

  return resp.choices[0].message.content.trim();
}

module.exports = {
  generateEmbedding,
  buildListingText,
  generateListingDescription,
  generateMarketNarrative,
  analyzePhoto,
  chatAnswer,
};
