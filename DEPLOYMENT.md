# Deployment Guide (Production)

This project has **two deployable components**:

1. **Vercel** — static site (`app/`) + IDX proxy serverless functions (`api/idx/`)
2. **Platform server** — Fastify API (`server/`) + PostgreSQL DB — deploy to Railway, Render, or a VPS

---

## Part 1: Vercel (frontend + IDX proxy)

### Pre-deployment checklist

1. Configure IDX gateway environment variables in Vercel (see §2).
2. Replace the contact form endpoint: `action="https://formspree.io/f/YOUR_FORM_ID"`
3. Confirm canonical + social URL values.
4. Confirm social profile links and `twitter:site` handle.
5. Replace placeholder phone values in JSON-LD and JS obfuscated phone block.
6. Verify `app/robots.txt` points to your live sitemap URL.
7. In `vercel.json`, replace `PLATFORM_SERVER_URL` with your actual Railway/Render URL once deployed.

### IDX gateway setup

#### Obtain MLS/IDX API credentials

1. Log in to your **Spark API** (Bridge Interactive) account at [sparkapi.com](https://sparkapi.com).
2. Go to **API Access** → **Applications** → **New Application**.
3. Record your **Client ID** and **Client Secret**.
4. Confirm your account has the **IDX** permission tier enabled.

#### Set Vercel environment variables

In Vercel project → **Settings** → **Environment Variables**:

| Name | Value |
|------|-------|
| `IDX_BASE_URL` | `https://api.sparkapi.com` |
| `IDX_CLIENT_ID` | Your Spark API client ID |
| `IDX_CLIENT_SECRET` | Your Spark API client secret |
| `SITE_ORIGIN` | `https://www.donnasellslv.com` |

When you obtain a RESO direct-feed license from GLVAR, also add:

| Name | Value |
|------|-------|
| `RESO_BASE_URL` | `https://replication.sparkapi.com/Reso/OData` |
| `RESO_CLIENT_ID` | Your RESO client ID |
| `RESO_CLIENT_SECRET` | Your RESO client secret |

### Verify the connection

```
GET https://www.donnasellslv.com/api/idx/verify
```

Expected response: `{ "connected": true, "accountId": "...", "permissions": [...] }`

### Validate before release

```bash
python -c "from html.parser import HTMLParser; HTMLParser().feed(open('app/index.html', encoding='utf-8').read()); print('HTML parse OK')"
```

### Deploy to Vercel

1. Import the Git repository at [vercel.com/new](https://vercel.com/new)
2. Leave all build settings at defaults — `vercel.json` handles them
3. Add environment variables before first deploy
4. Click **Deploy**
5. Add custom domain (`donnasellslv.com`) in Project → Settings → Domains

---

## Part 2: Platform server (Railway / Render)

### Requirements

- Node.js 20+
- PostgreSQL 15+ with **PostGIS** and **pgvector** extensions
- (Optional) Redis — not required; pg-boss uses PostgreSQL for job queues

### Recommended: Railway

Railway provides PostgreSQL with PostGIS pre-installed. pgvector can be enabled as a plugin.

1. Create a new Railway project
2. Add a **PostgreSQL** service (click + → Database → PostgreSQL)
3. Enable the `pgvector` plugin in the PostgreSQL service settings
4. Add a new **Service** and connect it to this GitHub repository
5. Set the start command to `node server/index.js`
6. Add environment variables (see below)
7. Railway auto-assigns a `DATABASE_URL` — link it to the server service

### Environment variables (platform server)

Copy `.env.example` and fill in all values. Minimum required:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Random 64+ char secret |
| `RESO_BASE_URL` | RESO endpoint (or use `IDX_*` Spark credentials) |
| `OPENAI_API_KEY` | For AI features |
| `SITE_ORIGIN` | Production domain for CORS |

### Run migrations

```bash
npm run migrate
```

### Initial MLS sync

```bash
npm run sync:now        # delta sync
npm run sync:now -- --full   # full sync (first time — may take minutes)
```

### Start server

```bash
npm start               # production
npm run dev             # development with auto-restart
```

The scheduler starts automatically with the server (15-min delta sync, daily 3 AM full sync).

### Connect Vercel to platform server

In `vercel.json`, replace `PLATFORM_SERVER_URL` in the rewrites section with your Railway/Render URL:

```json
{
  "source": "/api/v2/:path*",
  "destination": "https://your-app.railway.app/v2/:path*"
}
```

Redeploy Vercel after updating `vercel.json`.

---

## Part 3: Nevada Horse Properties site (`app/horses/`)

The horse property site is a static subdirectory of `app/` and deploys automatically with Vercel alongside the main site — **no extra deployment steps needed**.

### Pre-deployment checklist

1. Update the horse site contact form `action` attribute in `app/horses/index.html`:
   - Replace `https://formspree.io/f/YOUR_HORSE_FORM_ID` with a separate Formspree (or equivalent) form endpoint. Using a dedicated form ID lets you route horse property inquiries differently from general luxury inquiries.
2. Confirm social profile URLs in `app/horses/index.html` match current handles.
3. Confirm canonical URL: `<link rel="canonical" href="https://www.donnasellslv.com/horses/" />`
4. Replace placeholder phone parts in the JS obfuscation block near the bottom of `app/horses/index.html` with the real number.

### URL structure

| URL | File |
|-----|------|
| `https://www.donnasellslv.com/` | `app/index.html` |
| `https://www.donnasellslv.com/horses/` | `app/horses/index.html` |
| `https://www.donnasellslv.com/horses/styles.css` | `app/horses/styles.css` |

Vercel's `cleanUrls: true` setting in `vercel.json` serves `app/horses/index.html` at `/horses/` without the `.html` extension.

### IDX search on the horse site

The horse property search form posts to the same `/api/idx/search` endpoint as the main site. Horse-specific filters (barn, arena, round pen, pasture) are passed as additional keyword terms in the `location` parameter so the Spark/RESO gateway can include them in the MLS remarks/keyword filter.

When a horse-specific feature is selected:
- `barn` → appends `"barn"` to the location search term
- `arena` → appends `"arena"`
- `round-pen` → appends `"round pen"`
- `pasture` → appends `"pasture"`
- `horse-property` → appends `"horse property"` (matches the GLVAR MLS horse property flag)

For more precise filtering, the platform server's `/v2/listings` endpoint supports the `q` natural-language parameter (semantic search), which can be used to query: *"horse property with 6-stall barn and arena in Henderson"*.

### SEO notes

The horse site has dedicated:
- Canonical URL (`/horses/`)
- Open Graph tags with horse property hero image
- Twitter Card
- `RealEstateAgent` + `LocalBusiness` JSON-LD with Henderson address and equestrian area-served data
- Separate `FAQPage` JSON-LD with 6 horse-property-specific Q&As
- Meta keywords targeting horse property, A-1 zoning, equestrian estate, and Henderson/Clark County terms
- `geo.*` meta tags pointing to Henderson coordinates

Submit `https://www.donnasellslv.com/horses/` separately in Google Search Console after launch.

### Post-deployment verification

1. Verify `https://www.donnasellslv.com/horses/` loads with the earthy horse property design
2. Verify navigation link from main site (`donnasellslv.com/`) to horse site works (if added)
3. Verify horse property search form hits `/api/idx/search` and renders results
4. Verify contact form submits to the correct Formspree endpoint
5. Verify `/horses/` appears in Google Search Console after sitemap submission


1. Verify `https://www.donnasellslv.com/` loads correctly
2. Verify `https://www.donnasellslv.com/api/idx/verify` returns `connected: true`
3. Verify `https://your-platform-server.railway.app/health` returns `{"status":"ok"}`
4. Verify `GET /v2/listings` returns listing results
5. Verify `GET /v2/admin/sync/status` returns listing counts (admin JWT required)
6. Run Lighthouse and confirm no critical accessibility/SEO issues
7. Monitor form submissions and IDX search results for 24 hours

## Rollback

If an issue is found with Vercel:
1. Re-deploy the previous commit in Vercel dashboard
2. Re-verify IDX gateway and forms

If an issue is found with the platform server:
1. Re-deploy the previous Railway/Render deployment
2. Re-verify `/health` and `/v2/listings`

