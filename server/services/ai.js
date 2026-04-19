'use strict';

/**
 * AI service — self-hosted first, cloud optional.
 *
 * Default provider: Ollama (runs locally or on the same VPS).
 *   Install: https://ollama.com
 *   Models:  ollama pull nomic-embed-text   (embeddings, 768-dim)
 *            ollama pull llama3.2           (chat / descriptions / narratives)
 *            ollama pull llava              (photo feature tagging, vision)
 *
 * Fallback provider: OpenAI (set AI_PROVIDER=openai or OPENAI_API_KEY when
 *   Ollama is not available).
 *
 * Provides:
 *  - generateEmbedding()          — 768-dim vector for semantic search
 *  - generateListingDescription() — AI-written listing description
 *  - generateMarketNarrative()    — neighbourhood market summary
 *  - analyzePhoto()               — feature tags from listing photos
 *  - chatAnswer()                 — conversational listing assistant
 *  - buildListingText()           — shared text corpus builder
 */

const config = require('../config');

// ─── Provider detection ──────────────────────────────────────────────────────

function isOllama() {
  return config.ai.provider === 'ollama';
}

// ─── Ollama HTTP helpers ─────────────────────────────────────────────────────

async function ollamaPost(path, body, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.ai.ollamaBaseUrl}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${path} error ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── OpenAI lazy init ────────────────────────────────────────────────────────

let _openai = null;

function getOpenAI() {
  if (_openai) return _openai;
  if (!config.ai.openaiApiKey) {
    throw new Error(
      'AI features are unavailable: Ollama is not reachable and OPENAI_API_KEY is not set. ' +
      'Start Ollama (https://ollama.com) or set AI_PROVIDER=openai with a valid key.'
    );
  }
  const { OpenAI } = require('openai');
  _openai = new OpenAI({ apiKey: config.ai.openaiApiKey });
  return _openai;
}

// ─── Text corpus builder ─────────────────────────────────────────────────────

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

// ─── Embeddings ──────────────────────────────────────────────────────────────

/**
 * Generate a text embedding vector.
 * Ollama: 768-dimensional (nomic-embed-text).
 * OpenAI: 1536-dimensional (text-embedding-3-small).
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text) {
  const input = text.slice(0, 8192);

  if (isOllama()) {
    try {
      const resp = await ollamaPost('/api/embeddings', {
        model:  config.ai.ollamaEmbedModel,
        prompt: input,
      });
      return resp.embedding;
    } catch (err) {
      console.warn('[ai] Ollama embedding failed, trying OpenAI fallback:', err.message);
      // fall through to OpenAI
    }
  }

  const openai = getOpenAI();
  const resp   = await openai.embeddings.create({
    model: config.ai.openaiEmbedModel,
    input,
  });
  return resp.data[0].embedding;
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

  if (isOllama()) {
    try {
      const resp = await ollamaPost('/api/chat', {
        model:  config.ai.ollamaChatModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.7, num_predict: 500 },
      });
      return resp.message.content.trim();
    } catch (err) {
      console.warn('[ai] Ollama description failed, trying OpenAI fallback:', err.message);
    }
  }

  const openai = getOpenAI();
  const resp = await openai.chat.completions.create({
    model:       config.ai.openaiChatModel,
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

  if (isOllama()) {
    try {
      const resp = await ollamaPost('/api/chat', {
        model:  config.ai.ollamaChatModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.5, num_predict: 200 },
      });
      return resp.message.content.trim();
    } catch (err) {
      console.warn('[ai] Ollama narrative failed, trying OpenAI fallback:', err.message);
    }
  }

  const openai = getOpenAI();
  const resp = await openai.chat.completions.create({
    model:       config.ai.openaiChatModel,
    messages:    [{ role: 'user', content: prompt }],
    max_tokens:  200,
    temperature: 0.5,
  });
  return resp.choices[0].message.content.trim();
}

// ─── Photo analysis ──────────────────────────────────────────────────────────

/**
 * Analyse a listing photo and return feature tags.
 * Ollama: LLaVA (multimodal vision model, runs locally).
 * OpenAI fallback: GPT-4o vision.
 *
 * @param {string} imageUrl  publicly accessible image URL
 * @returns {Promise<string[]>}  e.g. ['pool','open-concept kitchen','mountain view']
 */
async function analyzePhoto(imageUrl) {
  const tagPrompt = 'List the notable real estate features visible in this photo as a JSON array of short tags (e.g. ["pool","granite countertops","mountain view","open floor plan"]). Return only the JSON array, no other text.';

  if (isOllama()) {
    try {
      // LLaVA accepts images as base64 or URL strings in the 'images' field
      const imageData = await fetchImageAsBase64(imageUrl);
      if (imageData) {
        const resp = await ollamaPost('/api/chat', {
          model:  config.ai.ollamaVisionModel,
          stream: false,
          messages: [{
            role:    'user',
            content: tagPrompt,
            images:  [imageData],
          }],
          options: { temperature: 0.2, num_predict: 150 },
        });
        return parseTagsFromContent(resp.message.content.trim());
      }
    } catch (err) {
      console.warn('[ai] Ollama photo analysis failed, trying OpenAI fallback:', err.message);
    }
  }

  const openai = getOpenAI();
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: tagPrompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
      ],
    }],
    max_tokens: 150,
  });
  return parseTagsFromContent(resp.choices[0].message.content.trim());
}

// ─── Listing chatbot ─────────────────────────────────────────────────────────

/**
 * Answer a buyer question about a specific listing.
 * Ollama: llama3.2 (or configured model, runs locally).
 * OpenAI fallback: gpt-4o-mini.
 *
 * @param {object} listing    compliance-filtered listing object
 * @param {object[]} history  [{role:'user'|'assistant', content:string}]
 * @param {string} question   new user question
 * @returns {Promise<string>}
 */
async function chatAnswer(listing, history, question) {
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
    ...history.slice(-10),
    { role: 'user', content: question },
  ];

  if (isOllama()) {
    try {
      const resp = await ollamaPost('/api/chat', {
        model:  config.ai.ollamaChatModel,
        stream: false,
        messages,
        options: { temperature: 0.3, num_predict: 400 },
      });
      return resp.message.content.trim();
    } catch (err) {
      console.warn('[ai] Ollama chat failed, trying OpenAI fallback:', err.message);
    }
  }

  const openai = getOpenAI();
  const resp = await openai.chat.completions.create({
    model:       config.ai.openaiChatModel,
    messages,
    max_tokens:  400,
    temperature: 0.3,
  });
  return resp.choices[0].message.content.trim();
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Fetch an image URL and return it as a base64 string (without data-URI prefix).
 * Returns null on failure so callers can skip gracefully.
 */
async function fetchImageAsBase64(imageUrl) {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  } catch {
    return null;
  }
}

/** Parse a JSON tag array out of an LLM response, with fallback. */
function parseTagsFromContent(content) {
  try {
    const tags = JSON.parse(content);
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch {
    const matches = content.match(/"([^"]+)"/g) || [];
    return matches.map((m) => m.replace(/"/g, ''));
  }
}

module.exports = {
  generateEmbedding,
  buildListingText,
  generateListingDescription,
  generateMarketNarrative,
  analyzePhoto,
  chatAnswer,
};
