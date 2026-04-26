'use strict';

/**
 * Redis caching layer for performance optimization.
 */

const redis = require('redis');
const config = require('./config');

let client;
let initErrorLogged = false;

function init() {
  if (!config.redis.enabled) return null;

  if (!client) {
    client = redis.createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
      },
      password: config.redis.password || undefined,
      database: config.redis.db,
    });

    client.on('error', (err) => {
      // Log once to avoid noisy repeated errors when Redis is unavailable.
      if (!initErrorLogged) {
        console.warn('Redis connection error:', err.message);
        initErrorLogged = true;
      }
    });

    client.on('connect', () => {
      console.log('Redis connected');
      initErrorLogged = false;
    });

    client.connect().catch(err => {
      if (!initErrorLogged) {
        console.warn('Failed to connect to Redis:', err.message);
        initErrorLogged = true;
      }
    });
  }
  return client;
}

async function get(key) {
  try {
    if (!client || !client.isReady) return null;
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn('Cache get error:', error.message);
    return null;
  }
}

async function set(key, value, ttl = 3600) {
  try {
    if (!client || !client.isReady) return;
    await client.setEx(key, ttl, JSON.stringify(value));
  } catch (error) {
    console.warn('Cache set error:', error.message);
  }
}

async function del(key) {
  try {
    if (!client || !client.isReady) return;
    await client.del(key);
  } catch (error) {
    console.warn('Cache del error:', error.message);
  }
}

module.exports = { init, get, set, del };