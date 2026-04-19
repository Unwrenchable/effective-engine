'use strict';

/**
 * PostgreSQL connection pool singleton.
 * Reads DATABASE_URL first; falls back to individual DB_* vars.
 */

const { Pool } = require('pg');
const config   = require('../config');

let _pool = null;

function getPool() {
  if (_pool) return _pool;

  const poolConfig = config.db.url
    ? {
        connectionString: config.db.url,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
      }
    : {
        host:     config.db.host,
        port:     config.db.port,
        database: config.db.name,
        user:     config.db.user,
        password: config.db.pass,
        ssl:      config.db.ssl ? { rejectUnauthorized: false } : undefined,
      };

  _pool = new Pool({
    ...poolConfig,
    max:              20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  _pool.on('error', (err) => {
    console.error('[db] Unexpected pool error:', err.message);
  });

  return _pool;
}

/**
 * Run a parameterised query and return the result rows.
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const pool   = getPool();
  const start  = Date.now();
  const result = await pool.query(text, params);
  const dur    = Date.now() - start;
  if (dur > 500) console.warn(`[db] Slow query (${dur}ms):`, text.slice(0, 120));
  return result;
}

/**
 * Run multiple queries in a single transaction.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, transaction };
