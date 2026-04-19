# Deployment Guide (Production)

This project is a static site. Deploy the `app/` folder as your web root.

## 1) Pre-deployment production checklist

1. Update search form endpoint in `app/index.html`:
   - `action="https://www.donnasellslv.com/search"` (or your IDX/MLS endpoint)
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

## 2) Validate before release

Run from repository root:

```bash
python -c "from html.parser import HTMLParser; HTMLParser().feed(open('app/index.html', encoding='utf-8').read()); print('HTML parse OK')"
```

Then manually verify:
- Mobile menu opens/closes and remains keyboard-accessible
- Search form submits to IDX URL
- Contact form submits to your live handler
- Footer phone renders correctly
- No `YOUR_FORM_ID` or TODO placeholders remain

## 3) Deploy options

### Netlify
1. New site from Git repository
2. Build command: *(none)*
3. Publish directory: `app`
4. Deploy
5. Add custom domain `donnasellslv.com` and enable HTTPS

### Vercel *(recommended — auto-configured)*
A `vercel.json` file at the repo root pre-configures everything:
- Output directory: `app`
- Production HTTP security headers
- Clean URLs and no trailing slash

**Steps:**
1. Import the Git repository at [vercel.com/new](https://vercel.com/new)
2. Leave all build settings at their defaults — `vercel.json` handles them
3. Click **Deploy**
4. Add your custom domain (`donnasellslv.com`) in Project → Settings → Domains
5. Vercel automatically provisions HTTPS/SSL

### GitHub Pages
1. In repository settings, enable Pages
2. Set source to GitHub Actions or branch/folder that serves `app/`
3. Ensure the deployed URL matches canonical/OG URL values
4. If using custom domain, configure DNS + HTTPS

## 4) Post-deployment checks

1. Verify:
   - `https://www.donnasellslv.com/`
   - `https://www.donnasellslv.com/robots.txt`
   - `https://www.donnasellslv.com/sitemap.xml`
2. Run Lighthouse and confirm no critical accessibility/SEO issues.
3. Submit sitemap in Google Search Console and Bing Webmaster Tools.
4. Monitor form submissions and IDX search routing for 24 hours.

## 5) Rollback

If an issue is found:
1. Re-deploy the previous known-good commit in your hosting provider
2. Re-verify forms, robots, canonical tags, and JSON-LD after rollback
