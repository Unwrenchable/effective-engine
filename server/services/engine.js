'use strict';

/**
 * Effective Engine runner.
 *
 * Supports RealAI-compatible chat endpoint with fallback echo mode.
 */

const config = require('../config');

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  const maxMessages = Math.max(1, config.engine.maxMessages);
  const maxChars = Math.max(1, config.engine.maxCharsPerMessage);

  return messages
    .slice(-maxMessages)
    .filter((m) => m && typeof m.content === 'string')
    .map((m) => ({
      role: (m.role === 'assistant' || m.role === 'system') ? m.role : 'user',
      content: m.content.slice(0, maxChars),
    }));
}

async function callRealAI(messages) {
  const maxAttempts = Math.max(1, (config.engine.retries || 0) + 1);
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, config.engine.timeoutMs || 20000));

    try {
      const res = await fetch(config.engine.realaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.engine.realaiKey}`,
        },
        body: JSON.stringify({
          model: config.engine.realaiModel,
          messages,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`RealAI request failed: ${res.status} ${res.statusText} - ${text}`);
      }

      const data = await res.json();
      const output = data?.choices?.[0]?.message?.content ?? data?.output ?? JSON.stringify(data);

      return {
        output,
        meta: {
          provider: 'realai',
          model: config.engine.realaiModel,
          fallback: false,
          retriesUsed: attempt - 1,
        },
      };
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr;
}

/**
 * Simple agent runner.
 * - Uses RealAI when configured.
 * - Falls back to deterministic echo mode for local testing.
 */
async function runEngine({ messages }) {
  const started = Date.now();
  const cleanMessages = sanitizeMessages(messages);

  if (!cleanMessages.length) {
    return {
      output: '[echo-mode]',
      meta: {
        provider: 'echo',
        model: 'echo-v1',
        fallback: true,
        latencyMs: Date.now() - started,
      },
    };
  }

  if (!config.engine.realaiUrl || !config.engine.realaiKey) {
    const last = cleanMessages[cleanMessages.length - 1];
    return {
      output: `[echo-mode] ${last.content}`,
      meta: {
        provider: 'echo',
        model: 'echo-v1',
        fallback: true,
        latencyMs: Date.now() - started,
      },
    };
  }

  const result = await callRealAI(cleanMessages);
  return {
    output: result.output,
    meta: {
      ...result.meta,
      latencyMs: Date.now() - started,
      inputMessages: cleanMessages.length,
    },
  };
}

module.exports = {
  runEngine,
};
