'use strict';

const { query } = require('./db');

/**
 * Create a saved search alert.
 * @param {object} data
 * @param {number}   data.userId
 * @param {string}   data.name
 * @param {string}   [data.email]    override email for notifications
 * @param {object}   data.criteria   search params to save
 * @param {string}   [data.frequency] 'instant'|'daily'|'weekly'
 * @returns {Promise<object>}
 */
async function createAlert({ userId, name, email, criteria, frequency = 'instant' }) {
  const result = await query(
    `INSERT INTO saved_searches (user_id, name, email, criteria, frequency)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, criteria, frequency, created_at`,
    [userId, name, email || null, JSON.stringify(criteria), frequency]
  );
  return result.rows[0];
}

/**
 * List alerts for a user.
 * @param {number} userId
 * @returns {Promise<object[]>}
 */
async function getAlertsByUser(userId) {
  const result = await query(
    `SELECT id, name, email, criteria, frequency, is_active, created_at, last_notified_at
     FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Get all active alerts that need to be evaluated for new matches.
 * @returns {Promise<object[]>}
 */
async function getActiveAlerts() {
  const result = await query(
    `SELECT ss.id, ss.user_id, ss.email, ss.criteria, ss.frequency, ss.last_notified_at,
            u.email AS user_email
     FROM saved_searches ss
     JOIN users u ON u.id = ss.user_id
     WHERE ss.is_active = true`,
    []
  );
  return result.rows;
}

/**
 * Update the last_notified_at timestamp on an alert.
 * @param {number} alertId
 */
async function touchAlert(alertId) {
  await query(
    'UPDATE saved_searches SET last_notified_at = NOW() WHERE id = $1',
    [alertId]
  );
}

/**
 * Record a notification sent for an alert/listing pair.
 * @param {number} alertId
 * @param {string} listingId
 */
async function recordNotification(alertId, listingId) {
  await query(
    `INSERT INTO alert_notifications (saved_search_id, listing_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [alertId, listingId]
  );
}

module.exports = { createAlert, getAlertsByUser, getActiveAlerts, touchAlert, recordNotification };
