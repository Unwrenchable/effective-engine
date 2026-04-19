'use strict';

/**
 * Admin routes (protected: admin role required)
 *
 * POST /v2/admin/sync         — trigger manual sync (delta or full)
 * GET  /v2/admin/sync/status  — last sync time + stats
 * GET  /v2/admin/reso/verify  — test RESO connection
 */

const { query }          = require('../../models/db');
const { verifyConnection } = require('../../sync/reso-client');

module.exports = async function adminRoutes(fastify) {

  fastify.addHook('onRequest', fastify.authenticate);

  // Admin-only guard
  fastify.addHook('preHandler', async (req, reply) => {
    if (req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin access required.' });
    }
  });

  // ── Manual sync trigger ───────────────────────────────────────────────────
  fastify.post('/sync', {
    schema: {
      body: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['delta', 'full'], default: 'delta' },
        },
      },
    },
  }, async (req, reply) => {
    const syncType = req.body?.type || 'delta';

    // Run sync in the background — don't block the HTTP response
    setImmediate(async () => {
      const { deltaSync, fullSync } = require('../../sync/ingest');
      const fn = syncType === 'full' ? fullSync : deltaSync;
      try {
        await fn();
      } catch (err) {
        fastify.log.error(err, 'Manual sync failed');
      }
    });

    return reply.code(202).send({
      message: `${syncType} sync started in background.`,
      type:    syncType,
    });
  });

  // ── Sync status ───────────────────────────────────────────────────────────
  fastify.get('/sync/status', async (_req, reply) => {
    const stateResult = await query(
      `SELECT value, updated_at FROM sync_state WHERE key = 'last_delta_sync'`,
      []
    );
    const countResult = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN mls_status = 'Active' THEN 1 ELSE 0 END) AS active
       FROM listings`,
      []
    );

    return reply.send({
      last_sync:       stateResult.rows[0]?.value || null,
      last_sync_at:    stateResult.rows[0]?.updated_at || null,
      total_listings:  parseInt(countResult.rows[0].total, 10),
      active_listings: parseInt(countResult.rows[0].active, 10),
    });
  });

  // ── RESO connection verify ────────────────────────────────────────────────
  fastify.get('/reso/verify', async (_req, reply) => {
    try {
      const result = await verifyConnection();
      return reply.send(result);
    } catch (err) {
      return reply.code(503).send({ connected: false, error: err.message });
    }
  });
};
