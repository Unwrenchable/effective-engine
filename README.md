# effective-engine

Production-ready luxury real estate platform for [Donna Sells LV](https://www.donnasellslv.com/) — and the foundation for a **proprietary MLS / IDX provider** ecosystem.

## Sites

This repository powers **two distinct frontends** under the same Vercel deployment:

| URL | File | Audience |
|-----|------|----------|
| `donnasellslv.com/` | `app/index.html` | Luxury real estate buyers/sellers across the Las Vegas Valley |
| `donnasellslv.com/horses/` | `app/horses/index.html` | Henderson equestrian community — horse property buyers and sellers |

### Site 1: Donna Sells LV (Luxury Real Estate)

Dark midnight-blue / saddle-gold luxury aesthetic. Serves high-net-worth buyers and sellers across Summerlin, Henderson, Southern Highlands, Strip penthouses, and all Las Vegas Valley guard-gated communities.

### Site 2: Nevada Horse Properties

`app/horses/` — earthy desert tones (dark earth, warm parchment, Nevada sage green, saddle gold). Built specifically for the Henderson equestrian community.

**Why it exists:** Donna and Jeremy are active members of the Henderson horse community — they own horses and know this world firsthand. Horse properties have unique requirements (A-1/A-2 zoning, water rights, barn quality, arena footing, trail access, HOA restrictions on livestock) that a generic luxury site doesn't address. This frontend speaks directly to that audience with dedicated content:
- Horse property MLS search with equestrian filters (acreage, barn, arena, round pen, pasture)
- Featured equestrian property cards with feature tags (stall count, arena, acreage)
- *What Makes a Great Horse Property* — 9-point evaluation guide
- *Henderson Equestrian Community* — Cornerstone Park equestrian area, River Mountains Loop Trail, Lake Mead/BLM open space, East Henderson horse corridor, Boulder City ranchettes, North LV A-1 zones
- *Nevada Zoning & Law Essentials* — A-1/A-2/R-E zoning, NRS 40.140 Right to Farm Act, water rights, HOA alert, commercial operation permits
- Clark County horse property market snapshot
- Contact form with horse-specific fields (horse count, facility needs)

---

## Architecture

```
effective-engine/
│
├── app/                   Static frontend (HTML/CSS) — Vercel CDN
│   ├── index.html         Site 1: Donna Sells LV (luxury real estate)
│   ├── styles.css         Site 1 styles
│   ├── horses/
│   │   ├── index.html     Site 2: Nevada Horse Properties
│   │   └── styles.css     Site 2 styles (earthy equestrian design system)
│
├── api/idx/               Vercel Serverless — IDX proxy (existing, kept for compatibility)
│   ├── _lib/client.js     Spark API + RESO Web API client
│   ├── _lib/compliance.js IDX display-rule enforcement
│   ├── search.js          GET /api/idx/search
│   ├── verify.js          GET /api/idx/verify
│   └── listing/[id].js    GET /api/idx/listing/:id
│
├── server/                Platform API server (Fastify — deploy to Railway/Render/VPS)
│   ├── index.js           Server entry point
│   ├── config.js          Centralised ENV variable loading
│   ├── routes/            API route handlers
│   │   ├── listings.js    GET/POST /v2/listings
│   │   ├── market.js      GET /v2/market/stats
│   │   ├── neighborhoods.js  GET /v2/neighborhoods/:slug
│   │   ├── alerts.js      CRUD /v2/alerts
│   │   ├── agents.js      GET /v2/agents/:mlsId
│   │   ├── inquiries.js   POST /v2/inquiries
│   │   ├── auth.js        POST /v2/auth/*
│   │   └── admin/sync.js  Admin sync control
│   ├── models/            Database access layer (PostgreSQL)
│   ├── services/          Business logic
│   │   ├── search.js      Structured + semantic (vector) search
│   │   ├── ai.js          OpenAI: embeddings, descriptions, photo tags, chatbot
│   │   ├── market.js      Market stats + AI narratives
│   │   ├── avm.js         Automated Valuation Model
│   │   └── compliance.js  IDX display rules
│   └── sync/              MLS data pipeline
│       ├── reso-client.js RESO Web API (OData) client — direct MLS feed
│       ├── ingest.js      Full + delta sync jobs
│       ├── media.js       Photo CDN pipeline (R2/S3)
│       └── scheduler.js   pg-boss cron scheduler
│
└── db/
    ├── migrations/        PostgreSQL schema (PostGIS + pgvector)
    └── migrate.js         Migration runner
```

## What's included

### Existing (Vercel serverless — always on)
- **Property search** wired to `/api/idx/search`
- **IDX gateway** — securely proxies Spark API or RESO direct feed
- **GLVAR compliance** — opt-out filtering, field redaction, photo caps, attribution
- **Listing detail** — full MLS record at `/api/idx/listing/:id`

### New platform server (`server/`)
- **RESO Web API client** — direct MLS feed replacing Spark once vendor-licensed
- **Local listing database** — PostgreSQL + PostGIS (geo) + pgvector (AI search)
- **Semantic search** — natural language via OpenAI embeddings + pgvector
- **AI description generation** — GPT-4 fills weak/missing listing remarks
- **AI market narratives** — per-neighbourhood stats summary (Summerlin, Henderson, etc.)
- **AI photo tagging** — GPT-4 vision extracts feature tags from photos
- **AVM (automated valuation)** — comparable-sales estimate for any listing
- **Listing chatbot** — conversational assistant on listing pages
- **Buyer alerts** — saved searches with email notifications on new matches
- **JWT auth** — consumer/agent/broker/admin roles
- **API key issuance** — sub-license IDX display to other agents (you become the provider)
- **Agent portal API** — agent listings, lead inbox endpoints
- **Admin sync API** — trigger manual full/delta MLS sync
- **Off-market listings table** — pocket listings compliant with NAR Clear Cooperation Policy
- **Compliance audit log** — automated per-session IDX display records for MLS reporting

## API endpoints (platform server `/v2/`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v2/listings` | Search listings (structured + natural language) |
| `GET` | `/v2/listings/:id` | Full listing detail |
| `GET` | `/v2/listings/:id/similar` | AI-powered similar listings |
| `GET` | `/v2/listings/:id/avm` | Automated valuation estimate |
| `POST` | `/v2/listings/:id/chat` | Conversational listing assistant |
| `GET` | `/v2/market/stats` | Market stats (price, DOM, inventory) |
| `GET` | `/v2/neighborhoods` | List all tracked neighborhoods |
| `GET` | `/v2/neighborhoods/:slug` | Neighborhood profile + AI narrative |
| `POST` | `/v2/auth/register` | Create consumer account |
| `POST` | `/v2/auth/login` | Obtain JWT |
| `GET` | `/v2/auth/me` | Current user info |
| `POST` | `/v2/auth/api-keys` | Issue IDX API key (broker/admin) |
| `POST` | `/v2/alerts` | Create saved search alert |
| `GET` | `/v2/alerts` | List user's alerts |
| `DELETE` | `/v2/alerts/:id` | Remove alert |
| `GET` | `/v2/agents/:mlsId` | Agent profile |
| `GET` | `/v2/agents/:mlsId/listings` | Agent's active listings |
| `POST` | `/v2/inquiries` | Capture buyer/seller lead |
| `POST` | `/v2/admin/sync` | Trigger manual MLS sync (admin) |
| `GET` | `/v2/admin/sync/status` | Sync status + listing counts (admin) |
| `GET` | `/v2/admin/reso/verify` | Test RESO connection (admin) |

### `GET /v2/listings` query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Natural language query — triggers semantic search |
| `location` | string | City, community, or zip code |
| `minPrice` | integer | Minimum list price |
| `maxPrice` | integer | Maximum list price |
| `minBeds` | integer | Minimum bedrooms |
| `minBaths` | integer | Minimum bathrooms |
| `propertyType` | string | e.g. `Residential` |
| `propertySubType` | string | e.g. `Condominium` |
| `lat` / `lng` | number | Geo centre for radius search |
| `radiusMiles` | number | Radius in miles (default 10) |
| `sort` | string | `price-asc` · `price-desc` · `newest` · `relevant` |
| `page` | integer | 1-based page (default 1) |
| `pageSize` | integer | Results per page, max 50 (default 12) |

## IDX Gateway (existing Vercel functions)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/idx/verify` | Test MLS connection |
| `GET` | `/api/idx/search` | Search active listings |
| `GET` | `/api/idx/listing/:id` | Listing detail by MLS# |

## Environment variables

### Vercel (existing IDX proxy)

| Variable | Required | Description |
|----------|----------|-------------|
| `IDX_BASE_URL` | Yes | Spark API base URL |
| `IDX_CLIENT_ID` | OAuth2 | Spark OAuth2 client ID |
| `IDX_CLIENT_SECRET` | OAuth2 | Spark OAuth2 client secret |
| `IDX_API_KEY` | API key | Static bearer token alternative |
| `SITE_ORIGIN` | Yes | Production CORS origin |

### New RESO direct feed (when vendor license obtained)

| Variable | Description |
|----------|-------------|
| `RESO_BASE_URL` | RESO OData endpoint (activates direct feed mode) |
| `RESO_CLIENT_ID` | RESO OAuth2 client ID |
| `RESO_CLIENT_SECRET` | RESO OAuth2 client secret |
| `RESO_API_KEY` | Static token alternative |

### Platform server (full list in `.env.example`)

Set `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`, CDN settings, etc. See `.env.example`.

## Quick start (platform server)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL, OPENAI_API_KEY, etc.

# 3. Run database migrations
npm run migrate

# 4. Run initial MLS sync (requires RESO_BASE_URL or IDX_* credentials)
npm run sync:now

# 5. Start the server
npm run dev        # development (auto-restart)
npm start          # production
```

The server will listen on port 3001 by default and start the sync scheduler automatically.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full production deployment steps for both Vercel (frontend + IDX proxy) and Railway/Render (platform server).

