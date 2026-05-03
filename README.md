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
├── app/                   Static frontend (HTML/CSS)
│   ├── index.html         Site 1: Donna Sells LV (luxury real estate)
│   ├── styles.css         Site 1 styles
│   ├── horses/
│   │   ├── index.html     Site 2: Nevada Horse Properties
│   │   └── styles.css     Site 2 styles (earthy equestrian design system)
│
├── public/media/          Local photo storage (CDN_PROVIDER=local default)
│   └── listings/          Auto-created by the media pipeline
│
├── server/                All-in-one Fastify server (self-host on any VPS)
│   ├── index.js           Entry point — serves app/, /media, /api/idx/*, /v2/*
│   ├── config.js          Centralised ENV variable loading
│   ├── routes/            API route handlers
│   │   ├── idx.js         GET /api/idx/search|verify, /api/idx/listing/:id
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
│   │   ├── ai.js          Ollama (local) + OpenAI fallback: embeddings, descriptions, chatbot
│   │   ├── market.js      Market stats + AI narratives
│   │   ├── avm.js         Automated Valuation Model (comparable-sales)
│   │   └── compliance.js  IDX display rules (GLVAR)
│   └── sync/              MLS data pipeline
│       ├── reso-client.js RESO Web API (OData) client + RESO_MOCK=true dev mode
│       ├── ingest.js      Full + delta sync jobs
│       ├── media.js       Photo pipeline: local | minio | r2 | s3
│       └── scheduler.js   pg-boss cron scheduler
│
└── db/
    ├── migrations/        PostgreSQL schema (PostGIS + pgvector)
    │   ├── 007_local_ai.sql   Embedding dim 768 (nomic-embed-text)
    │   └── 008_future.sql     blockchain_tx_hash, showings, documents
    ├── seed/
    │   └── listings.json  Sample RESO listings for RESO_MOCK=true dev mode
    └── migrate.js         Migration runner
```

## What's included

### All-in-one Fastify server (`server/`)
- **IDX gateway** — `/api/idx/*` routes built into Fastify (replaces Vercel serverless)
- **RESO Web API client** — direct MLS feed; set `RESO_MOCK=true` for development (no live license needed)
- **Local listing database** — PostgreSQL + PostGIS (geo) + pgvector (AI search)
- **Semantic search** — natural language via local embeddings (Ollama `nomic-embed-text`) + pgvector
- **AI description generation** — local LLM (Ollama `llama3.2`) fills weak/missing listing remarks
- **AI market narratives** — per-neighbourhood stats summary (Summerlin, Henderson, etc.)
- **AI photo tagging** — local vision model (Ollama `llava`) extracts feature tags from photos
- **OpenAI optional fallback** — set `AI_PROVIDER=openai` when Ollama is not available
- **AVM (automated valuation)** — comparable-sales estimate, no external API
- **Listing chatbot** — conversational assistant on listing pages
- **Buyer alerts** — saved searches with email notifications on new matches
- **JWT auth** — consumer/agent/broker/admin roles
- **GLVAR IDX compliance** — opt-out filtering, field redaction, photo caps, attribution
- **Static file serving** — serves `app/` HTML/CSS and `public/media/` photos directly
- **Local photo storage** — `CDN_PROVIDER=local` (default); upgrade to MinIO, R2, or S3 via env var
- **Self-hosted email** — raw SMTP; point at your own Postfix/mailserver, no Sendgrid required
- **Future schema** — `showings` table (self-scheduling), `documents` table (e-signature), `blockchain_tx_hash`

## Third-party dependencies

| Dependency | Required? | Alternative |
|---|---|---|
| **MLS / RESO credentials** | Yes (for live data) | `RESO_MOCK=true` for dev |
| **Ollama** (AI) | Recommended | `AI_PROVIDER=openai` |
| **PostgreSQL** | Yes | Self-host on any VPS |
| **SMTP server** | Yes (for alerts) | Self-host Postfix / any SMTP |
| **Vercel** | No | Fastify serves everything |
| **OpenAI** | No | Ollama default |
| **Cloudflare R2 / AWS S3** | No | `CDN_PROVIDER=local` default |

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

## IDX Gateway (built into Fastify — no Vercel serverless needed)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/idx/verify` | Test RESO / mock connection |
| `GET` | `/api/idx/search` | Search active listings from local DB |
| `GET` | `/api/idx/listing/:id` | Listing detail by MLS# from local DB |

## Environment variables

Full list in `.env.example`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `RESO_MOCK` | `true` | Use seed data instead of live MLS feed |
| `RESO_BASE_URL` | — | Live RESO OData endpoint (when licensed) |
| `AI_PROVIDER` | `ollama` | `ollama` (self-hosted) or `openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `CDN_PROVIDER` | `local` | `local` · `minio` · `r2` · `s3` |
| `JWT_SECRET` | — | At least 64-char secret (required) |
| `SMTP_HOST` | `localhost` | Your SMTP server |

## Quick start

### macOS / Linux (bash)

```bash
# 1. Install Ollama (self-hosted AI)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull nomic-embed-text   # embeddings
ollama pull llama3.2           # chat / descriptions
ollama pull llava              # photo tags (vision)

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET at minimum

# 4. Run database migrations
npm run migrate

# 5. (Optional) Seed with mock listings for development
# RESO_MOCK=true is already the default in .env.example

# 6. Run initial MLS sync
npm run sync:now   # uses RESO_MOCK=true seed data by default

# 7. Start the server
npm run dev        # development (auto-restart)
npm start          # production
```

### Windows (PowerShell)

```powershell
# 1. Install Ollama (self-hosted AI)
#    Download the Windows installer from https://ollama.com/download and run it.
#    Then pull the required models:
ollama pull nomic-embed-text   # embeddings
ollama pull llama3.2           # chat / descriptions
ollama pull llava              # photo tags (vision)

# 2. Install dependencies
npm install

# 3. Set up environment
Copy-Item .env.example .env
# Open .env in a text editor and set DATABASE_URL and JWT_SECRET at minimum

# 4. Run database migrations
npm run migrate

# 5. (Optional) Seed with mock listings for development
# RESO_MOCK=true is already the default in .env.example

# 6. Run initial MLS sync
npm run sync:now   # uses RESO_MOCK=true seed data by default

# 7. Start the server
npm run dev        # development (auto-restart)
npm start          # production
```

The server listens on port 3001 by default.  It serves the `app/` frontend at `/`,
media files at `/media/`, IDX routes at `/api/idx/`, and the platform API at `/v2/`.

## Runtime topology (self-hosted)

```
Single VPS (Hetzner / Railway / Render / bare metal)
├── Node.js / Fastify  — serves everything on port 3001
│   ├── / (app/ static files)
│   ├── /media/* (local photo storage)
│   ├── /api/idx/* (IDX search, verify, listing detail)
│   └── /v2/* (platform API)
├── Ollama sidecar     — local LLM for AI features (no API key required)
├── PostgreSQL         — PostGIS + pgvector (fully self-hostable)
└── SMTP server        — Postfix or any SMTP (no Sendgrid required)
```

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full production deployment steps.

**Quick summary:**
1. **Render** (backend) — deploy via `render.yaml` Blueprint or manual setup
2. **Vercel** (frontend) — update `PLATFORM_SERVER_URL` in `vercel.json` with the Render URL, then deploy

