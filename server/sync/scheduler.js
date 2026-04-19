'use strict';

/**
 * Sync scheduler using pg-boss (PostgreSQL-backed job queue).
 *
 * Schedules:
 *  - Delta sync:  every SYNC_INTERVAL_MINUTES (default 15)
 *  - Full sync:   daily at SYNC_FULL_HOUR UTC (default 3 AM)
 *  - Alert eval:  every 30 minutes (check saved searches for new matches)
 */

const PgBoss    = require('pg-boss');
const config    = require('../config');
const { deltaSync, fullSync } = require('./ingest');

const JOB_DELTA_SYNC = 'mls:delta-sync';
const JOB_FULL_SYNC  = 'mls:full-sync';
const JOB_ALERTS     = 'mls:eval-alerts';

let _boss = null;

async function startScheduler() {
  const connectionString = config.db.url || buildConnectionString();

  _boss = new PgBoss({ connectionString, ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined });

  _boss.on('error', (err) => console.error('[scheduler] pg-boss error:', err.message));

  await _boss.start();

  // ── Register job workers ──────────────────────────────────────────────────

  await _boss.work(JOB_DELTA_SYNC, { teamSize: 1 }, async () => {
    console.log('[scheduler] Running delta sync…');
    try {
      const result = await deltaSync();
      console.log('[scheduler] Delta sync done:', result);
    } catch (err) {
      console.error('[scheduler] Delta sync failed:', err.message);
      throw err;  // pg-boss will retry
    }
  });

  await _boss.work(JOB_FULL_SYNC, { teamSize: 1 }, async () => {
    console.log('[scheduler] Running full sync…');
    try {
      const result = await fullSync();
      console.log('[scheduler] Full sync done:', result);
    } catch (err) {
      console.error('[scheduler] Full sync failed:', err.message);
      throw err;
    }
  });

  await _boss.work(JOB_ALERTS, { teamSize: 1 }, async () => {
    try {
      const { evalAlerts } = require('./alerts-eval');
      await evalAlerts();
    } catch (err) {
      console.error('[scheduler] Alert eval failed:', err.message);
      throw err;
    }
  });

  // ── Schedule recurring jobs ───────────────────────────────────────────────

  // Delta sync: every N minutes
  await _boss.schedule(
    JOB_DELTA_SYNC,
    `*/${config.sync.intervalMinutes} * * * *`,
    {},
    { tz: 'UTC' }
  );

  // Full sync: once a day at configured hour
  await _boss.schedule(
    JOB_FULL_SYNC,
    `0 ${config.sync.fullSyncHour} * * *`,
    {},
    { tz: 'UTC' }
  );

  // Alert evaluation: every 30 minutes
  await _boss.schedule(JOB_ALERTS, '*/30 * * * *', {}, { tz: 'UTC' });

  console.log(
    `[scheduler] Started. Delta sync every ${config.sync.intervalMinutes} min, ` +
    `full sync at ${config.sync.fullSyncHour}:00 UTC daily.`
  );

  return _boss;
}

async function stopScheduler() {
  if (_boss) {
    await _boss.stop();
    _boss = null;
  }
}

function buildConnectionString() {
  const { host, port, name, user, pass } = config.db;
  return `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${name}`;
}

module.exports = { startScheduler, stopScheduler };
