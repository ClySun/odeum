# Odeum — website

A static one-page site for Odeum, a private immersive-theatre company.
Plain HTML / CSS / JS — no build step, no dependencies.

```
index.html         The whole page
css/styles.css     Styling
js/main.js         Interactions (nav, reveals, invitation form)
images/            Photography used on the page
og.png             Social link-preview card (1200×630)
favicon.svg        Browser-tab icon
```

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Open via a server, not by double-clicking the file, so the fonts and JS load.)

## Deploy (Netlify, free)

**Fastest — drag & drop:**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page. You get a live URL in seconds.
3. Sign up (free) to keep the site, then **Site settings → Change site name** → `odeum`
   so the address becomes `https://odeum.netlify.app`.

**Easier to update later — connect Git:**
1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import from Git →** pick the repo. No build command; publish
   directory `.` (already set in `netlify.toml`).
3. From then on, every change you push auto-publishes.

## Updating the games

The two games live in `index.html` inside `<!-- GAMES -->`. Each is one `<div class="row ...">`
block: change the title (`row__name`), the location/date (`row__index`), the description, and the
status (`row__meta` + the `Coming Soon` badge). To launch a game, remove `row--soon` from that
row's class list and delete its `<figcaption class="row__badge">` to un-grey the photo.

## If your live URL is not `odeum.netlify.app`

Update the absolute URLs in these files to your real address:
- `index.html` — canonical, `og:url`, `og:image`, `twitter:image`
- `robots.txt` — the Sitemap line
- `sitemap.xml` — the `<loc>` line
