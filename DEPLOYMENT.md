# Deployment Guide (Production)

This project is a static site with Vercel Serverless Functions for the IDX gateway.
Deploy the repository to Vercel — `vercel.json` handles all configuration.

## 1) Pre-deployment production checklist

1. Configure IDX gateway environment variables in Vercel (see §2 below).
2. Replace the contact form endpoint:
   - `action="https://formspree.io/f/YOUR_FORM_ID"` with your live form provider URL
3. Confirm canonical + social URL values:
   - `link[rel="canonical"]`
   - `meta[property="og:url"]`
4. Confirm social profile links and `twitter:site` handle.
5. Replace placeholder phone values in:
   - JSON-LD `telephone`
   - JS obfuscated phone block near the end of `app/index.html`
6. Verify `app/robots.txt` points to your live sitemap URL.

## 2) IDX gateway setup

### Obtain MLS/IDX API credentials

1. Log in to your **Spark API** (Bridge Interactive) account at
   [sparkapi.com](https://sparkapi.com) — this is the standard IDX API for GLVAR.
2. Go to **API Access** → **Applications** → **New Application**.
3. Record your **Client ID** and **Client Secret**.
4. Confirm your account has the **IDX** permission tier enabled (contact your
   broker or GLVAR if needed).

### Set Vercel environment variables

In your Vercel project → **Settings** → **Environment Variables**, add:

| Name | Value |
|------|-------|
| `IDX_BASE_URL` | `https://api.sparkapi.com` |
| `IDX_CLIENT_ID` | Your Spark API client ID |
| `IDX_CLIENT_SECRET` | Your Spark API client secret |
| `SITE_ORIGIN` | `https://www.donnasellslv.com` |

> If your provider issues a permanent bearer token instead of OAuth2 credentials,
> set `IDX_API_KEY` with that token value (and leave `IDX_CLIENT_ID` / `IDX_CLIENT_SECRET` empty).

### Verify the connection

After deploying, run:

```
GET https://www.donnasellslv.com/api/idx/verify
```

Expected response:
```json
{ "connected": true, "accountId": "...", "permissions": ["ActiveListings", ...] }
```

## 3) Validate before release

Run from repository root:

```bash
python -c "from html.parser import HTMLParser; HTMLParser().feed(open('app/index.html', encoding='utf-8').read()); print('HTML parse OK')"
```

Then manually verify:
- Mobile menu opens/closes and remains keyboard-accessible
- Search form calls `/api/idx/search` and renders results inline
- `/api/idx/verify` returns `connected: true`
- Contact form submits to your live handler
- Footer phone renders correctly
- No `YOUR_FORM_ID` or TODO placeholders remain

## 4) Deploy options

### Vercel *(recommended — auto-configured)*

A `vercel.json` file at the repo root pre-configures everything:
- Output directory: `app`
- Serverless functions: `api/idx/**` running Node.js 20
- Production HTTP security headers
- Clean URLs and no trailing slash

**Steps:**
1. Import the Git repository at [vercel.com/new](https://vercel.com/new)
2. Leave all build settings at their defaults — `vercel.json` handles them
3. Add environment variables (§2 above) before first deploy
4. Click **Deploy**
5. Add your custom domain (`donnasellslv.com`) in Project → Settings → Domains
6. Vercel automatically provisions HTTPS/SSL

### Netlify

Netlify Functions support is not pre-configured. You would need to migrate
the `api/` serverless functions to Netlify Functions format. Vercel is
strongly recommended for this project.

### GitHub Pages

GitHub Pages serves only static files. The IDX gateway (`api/`) will not
work on GitHub Pages. Use Vercel or another platform that supports serverless
functions.

## 5) Post-deployment checks

1. Verify:
   - `https://www.donnasellslv.com/`
   - `https://www.donnasellslv.com/robots.txt`
   - `https://www.donnasellslv.com/sitemap.xml`
   - `https://www.donnasellslv.com/api/idx/verify`
2. Run Lighthouse and confirm no critical accessibility/SEO issues.
3. Submit sitemap in Google Search Console and Bing Webmaster Tools.
4. Monitor form submissions and IDX search results for 24 hours.

## 6) Rollback

If an issue is found:
1. Re-deploy the previous known-good commit in your hosting provider
2. Re-verify forms, robots, canonical tags, JSON-LD, and IDX gateway after rollback
