# effective-engine

Production-ready luxury real estate landing site for [Donna Sells LV](https://www.donnasellslv.com/).

## App

Open `app/index.html` in any browser, or serve the `app/` folder as the web root.

### What's included

- **Sticky nav** with mobile hamburger menu and skip-navigation link
- **Hero** with full-width background image and overlay
- **Property search** form wired for MLS/IDX integration (update the `action` URL)
- **Featured listings** with photos, prices, and showing CTAs
- **About section** with credential stats
- **Social links** for Instagram, Facebook, LinkedIn, and YouTube
- **Contact form** — replace `YOUR_FORM_ID` in the `action` attribute with your [Formspree](https://formspree.io/) (or equivalent) endpoint
- **Footer** with legal disclaimer and dynamic copyright year
- SEO: canonical URL, Open Graph, Twitter Card, schema.org `RealEstateAgent` JSON-LD
- Accessibility: ARIA labels, `focus-visible` styles, semantic HTML
- Print stylesheet

### Go live checklist

1. Update the contact form `action` URL with your form-handling endpoint.
2. Update the search form `action` URL to your IDX/MLS search page.
3. Update canonical URL and Open Graph `og:url` to your production domain.
4. Replace the Twitter `@donnasellslv` handle if needed.
5. Deploy the `app/` folder to any static host (Vercel, Netlify, GitHub Pages, etc.).
