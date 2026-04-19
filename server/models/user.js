'use strict';

const bcrypt      = require('bcryptjs');
const { query }   = require('./db');

const BCRYPT_ROUNDS = 12;

// ─── Users ───────────────────────────────────────────────────────────────────

/**
 * Create a user account.
 * @param {object} data
 * @param {string} data.email
 * @param {string} data.password  plaintext — will be hashed
 * @param {string} [data.role]   'admin'|'broker'|'agent'|'consumer'
 * @param {string} [data.fullName]
 * @returns {Promise<object>}
 */
async function createUser({ email, password, role = 'consumer', fullName }) {
  const hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await query(
    `INSERT INTO users (email, password_hash, role, full_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role, full_name, created_at`,
    [email.toLowerCase(), hash, role, fullName || null]
  );
  return result.rows[0];
}

/**
 * Find a user by email and verify their password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object|null>}  user row (without password_hash) or null
 */
async function verifyUserCredentials(email, password) {
  const result = await query(
    `SELECT id, email, role, full_name, password_hash, is_active FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !user.is_active) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  const { password_hash: _, ...safeUser } = user;
  return safeUser;
}

/**
 * Get user by ID (without password hash).
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function getUserById(id) {
  const result = await query(
    `SELECT id, email, role, full_name, is_active, created_at FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// ─── API Keys ────────────────────────────────────────────────────────────────

/**
 * Issue a new API key for sub-licensed IDX consumers.
 * @param {number} userId
 * @param {string} [label]
 * @param {string[]} [scopes]
 * @returns {Promise<{key: string, id: number}>}
 */
async function createApiKey(userId, label = '', scopes = ['idx:read']) {
  // Generate a 40-char random hex key
  const { randomBytes } = require('crypto');
  const rawKey = randomBytes(20).toString('hex');
  const hash   = await bcrypt.hash(rawKey, 10);

  const result = await query(
    `INSERT INTO api_keys (user_id, key_hash, label, scopes)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, hash, label, JSON.stringify(scopes)]
  );

  return { key: `dlv_${rawKey}`, id: result.rows[0].id };
}

/**
 * Verify an API key and return the associated user.
 * @param {string} rawKey  including 'dlv_' prefix
 * @returns {Promise<object|null>}
 */
async function verifyApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith('dlv_')) return null;
  const plain = rawKey.slice(4);

  const result = await query(
    `SELECT ak.id, ak.key_hash, ak.scopes, ak.is_active,
            u.id AS user_id, u.email, u.role, u.full_name
     FROM api_keys ak JOIN users u ON u.id = ak.user_id
     WHERE ak.is_active = true`,
    []
  );

  for (const row of result.rows) {
    const valid = await bcrypt.compare(plain, row.key_hash);
    if (valid) {
      // Update last_used
      query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [row.id]).catch(() => {});
      const { key_hash: _, ...safe } = row;
      return safe;
    }
  }
  return null;
}

module.exports = { createUser, verifyUserCredentials, getUserById, createApiKey, verifyApiKey };
