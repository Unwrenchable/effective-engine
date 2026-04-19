# effective-engine

Production-ready luxury real estate landing site for [Donna Sells LV](https://www.donnasellslv.com/).

## App

Open `app/index.html` in any browser, or serve the `app/` folder as the web root.

### What's included

- **Sticky nav** with mobile hamburger menu and skip-navigation link
- **Hero** with full-width background image and overlay
- **Property search** form wired to the on-site IDX gateway (`/api/idx/search`)
- **IDX gateway** — Vercel serverless functions that securely proxy MLS data
- **Featured listings** with photos, prices, and showing CTAs
- **About section** with credential stats
- **Social links** for Instagram, Facebook, LinkedIn, and YouTube
- **Contact form** — replace `YOUR_FORM_ID` in the `action` attribute with your [Formspree](https://formspree.io/) (or equivalent) endpoint
- **Footer** with legal disclaimer and dynamic copyright year
- SEO: canonical URL, Open Graph, Twitter Card, schema.org `RealEstateAgent` JSON-LD
- Accessibility: ARIA labels, `focus-visible` styles, semantic HTML
- Print stylesheet

### Go live checklist

1. Configure the IDX gateway environment variables in Vercel (see below).
2. Update the contact form `action` URL with your form-handling endpoint.
3. Update canonical URL and Open Graph `og:url` to your production domain.
4. Replace the Twitter `@donnasellslv` handle if needed.
5. Replace placeholder phone values in JSON-LD and footer phone obfuscation script.
6. Deploy the `app/` folder and `api/` functions to Vercel.

## IDX Gateway

The site includes a custom IDX gateway built as Vercel Serverless Functions.
All MLS data flows through these server-side routes — credentials never
reach the browser.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/idx/verify` | Test MLS connection; returns permissions |
| `GET` | `/api/idx/search` | Search active listings (see params below) |
| `GET` | `/api/idx/listing/:id` | Fetch full listing detail by MLS# |

#### `/api/idx/search` query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `location` | string | Community or city (e.g. `Summerlin`) |
| `minPrice` | integer | Minimum list price in USD |
| `maxPrice` | integer | Maximum list price in USD |
| `beds` | integer | Minimum bedroom count |
| `homeType` | string | `single-family` · `penthouse` · `condo` · `estate` · `new-construction` · `guard-gated` |
| `page` | integer | 1-based page number (default 1) |
| `pageSize` | integer | Results per page, 1–50 (default 12) |
| `sort` | string | `price-asc` · `price-desc` · `newest` (default) |

### Environment variables

Set these in your Vercel project → Settings → Environment Variables.
**Never commit credentials to source control.**

| Variable | Required | Description |
|----------|----------|-------------|
| `IDX_BASE_URL` | Yes | IDX API base URL (e.g. `https://api.sparkapi.com`) |
| `IDX_CLIENT_ID` | OAuth2 | OAuth2 client ID from your IDX provider |
| `IDX_CLIENT_SECRET` | OAuth2 | OAuth2 client secret |
| `IDX_API_KEY` | API key | Direct bearer token (takes precedence over OAuth2) |
| `SITE_ORIGIN` | Yes | Production origin for CORS (e.g. `https://www.donnasellslv.com`) |

> **Tip:** The gateway supports both OAuth2 Client Credentials (Spark API default)
> and static API keys. Set `IDX_API_KEY` alone if your provider issues a permanent
> token; otherwise set `IDX_CLIENT_ID` + `IDX_CLIENT_SECRET`.

### Compliance

Every response from `/api/idx/search` and `/api/idx/listing/:id` automatically:
- Strips listings that have opted out of IDX display
- Removes seller-identifying and private fields (GLVAR policy)
- Caps photos at the MLS-permitted maximum (25)
- Attaches the required "Courtesy of …" attribution line
- Includes the GLVAR IDX disclaimer text

## Deployment

For full production deployment steps, validation, host-specific setup, and rollback:

- See [`DEPLOYMENT.md`](./DEPLOYMENT.md)
