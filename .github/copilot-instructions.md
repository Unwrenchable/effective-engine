# Copilot Instructions

## Build, run, and validation

There is **no build script** in this repository. The frontend is static HTML/CSS in `app/`, and the server runs directly with Node.js 20+.

```bash
npm install
npm run migrate
npm run dev
npm start
npm run sync:now
npm run sync:now -- --full
node db/migrate.js --status
```

There are currently **no `npm test`, `npm run lint`, or single-test runner scripts**. The existing smoke checks are the documented/frontend validation commands used in docs and the Copilot setup workflow:

```bash
python -c "from html.parser import HTMLParser; HTMLParser().feed(open('app/index.html', encoding='utf-8').read()); print('HTML parse OK')"
python -c "from html.parser import HTMLParser; HTMLParser().feed(open('app/horses/index.html', encoding='utf-8').read()); print('HTML parse OK')"
```

If you need the same CSS parse check as the workflow, install `cssutils` and parse `app/styles.css`.

## High-level architecture

- `app/` is a static multi-site frontend: the main Donna Sells LV site lives in `app/index.html`, the horse-property site lives in `app/horses/index.html`, and there are separate static admin/analytics/engine pages under `app/admin`, `app/analytics`, and `app/engine`.
- `server/index.js` is the monolithic Fastify entry point. It serves the static frontend and local media directly when self-hosted, and in production Vercel serves `app/` while rewriting `/api/*` and `/v2/*` requests to the Fastify backend.
- The MLS/IDX data flow is: `server/sync/reso-client.js` fetches live RESO data (or seeded data when `RESO_MOCK=true`) -> `server/sync/ingest.js` normalizes/upserts listings and media -> `server/models/listing.js` queries PostgreSQL/PostGIS/pgvector -> `server/services/search.js` and `server/services/compliance.js` shape public listing responses for both `/api/idx/*` and `/v2/listings*`.
- PostgreSQL is the system of record for listings, auth, leads, newsletter, sync state, and the pg-boss scheduler. `server/sync/scheduler.js` starts with the server and schedules recurring delta/full MLS syncs plus alert evaluation.
- AI features are split across two paths: listing enrichment/search/chat use `server/services/ai.js`, while `/api/engine` is a separate RealAI-compatible harness implemented in `server/services/engine.js`. `server/routes/agent-studio.js` is another separate surface that reads agent/workflow definitions from `real_estate_agents.json` and `real_estate_workflows.json`.

## Key conventions

- **Centralized config:** server-side code should read environment variables through `server/config.js`, not `process.env` directly. Add new config there first, then import it where needed.
- **Public listing responses must stay IDX-compliant:** routes that expose listings should attach attribution and run through `server/services/compliance.js`. Public responses are snake_case, redact forbidden fields, cap photo counts, and include `_attribution`.
- **Do not bypass the local database for public listing APIs:** the frontend and public routes are built around the synced local store, not direct Spark/RESO calls. Keep the sync pipeline as the ingestion boundary.
- **Preserve static-page API contracts:** the HTML frontends call concrete paths like `/api/idx/search`, `/api/idx/listing/:id`, `/v2/inquiries`, `/v2/newsletter/subscribe`, and `/v2/admin/*`. If you change payloads or routes, update the static HTML that calls them.
- **Follow the Fastify schema-first pattern:** routes define inline JSON schemas and rely on the app-wide AJv configuration (`removeAdditional`, `coerceTypes`, `useDefaults`) plus the centralized error handler in `server/index.js` rather than ad hoc validation.
- **Offline/dev fallback is intentional:** `RESO_MOCK=true` is the normal local-development mode, and listing search/IDX code falls back to `db/seed/listings.json` when the database is unavailable.
- **Check both frontends for shared UX changes:** `app/index.html` and `app/horses/index.html` both implement search and lead capture, but with different site-specific content and `lead_source` values.
- **Use the code's S3 env names:** the live config expects `S3_BUCKET` and `S3_PUBLIC_URL` for AWS S3 media storage.
