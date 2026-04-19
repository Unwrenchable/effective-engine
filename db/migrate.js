#!/usr/bin/env node
'use strict';

/**
 * Database migration runner.
 *
 * Runs all migration files in db/migrations/ in order.
 * Tracks applied migrations in a `schema_migrations` table.
 *
 * Usage:
 *   node db/migrate.js           — run pending migrations
 *   node db/migrate.js --status  — list applied / pending migrations
 */

const path  = require('path');
const fs    = require('fs');
const { Pool } = require('pg');
const config   = require('../server/config');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const pool = new Pool(
    config.db.url
      ? { connectionString: config.db.url, ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined }
      : { host: config.db.host, port: config.db.port, database: config.db.name, user: config.db.user, password: config.db.pass }
  );

  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query(
      `SELECT filename FROM schema_migrations ORDER BY filename`
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const showStatus = process.argv.includes('--status');

    if (showStatus) {
      console.log('\nMigration status:');
      for (const file of files) {
        const status = appliedSet.has(file) ? '✓ applied' : '○ pending';
        console.log(`  ${status}  ${file}`);
      }
      console.log();
      return;
    }

    const pending = files.filter((f) => !appliedSet.has(f));
    if (!pending.length) {
      console.log('All migrations already applied. Database is up to date.');
      return;
    }

    console.log(`Running ${pending.length} pending migration(s)…\n`);

    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql      = fs.readFileSync(filepath, 'utf8');

      console.log(`  → ${filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [filename]
        );
        await client.query('COMMIT');
        console.log(`     ✓ done`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`     ✗ failed: ${err.message}`);
        process.exit(1);
      }
    }

    console.log(`\n✓ All migrations applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
