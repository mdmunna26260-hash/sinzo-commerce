# Full Website Test Report — 2026-11-03 (tester pass)

Environment: dev preview on port 3000, local PG (sandbox), seed data.
Method: crawled all public pages + static assets + key APIs, checked status codes,
rendered content markers, auth behaviour, and image variant URLs.

## Result summary
- Public pages: all 200 (/, /products + filters/sort/page, /cart, /checkout, /blog,
  /track, /returns, /account, /login, /admin/login, robots.txt, sitemap.xml, manifest,
  favicon, icons) — OK
- PDPs for all 8 seed products: 200, title/price/Buy/Add/size buttons render — OK
- Collections (/collections/new-arrivals|best-sellers|sale): 200 — OK
- Static assets: 36/36 referenced js/css/img 200 — OK
- APIs: /api/health 200, /api/search 200, /api/track/event 200 (proper `name` field;
  400 without it = correct validation), /api/coupon 400 on bad body = correct,
  /api/newsletter 200, /api/admin/settings 401 unauthenticated = correct,
  /api/admin/login 401 on wrong password = correct, /api/checkout/start 400 on empty cart = correct
- Auth: admin pages serve shell (client-side guard), all admin APIs 401 without session — OK

## Problems found

### 1. [FIXED during test] w1600 image variants missing → 404
Hero carousel requests widths [600, 1000, 1600]; seed images only had up to -1200
(products) / -2000 (hero). `/uploads/seed/*-1600.webp` returned 404 for hero-1600,
p-shirt-1600, p-coat-1600, p-dress-1600 → on viewports ≥ ~1600px wide the browser picks
the 1600w candidate and the hero/product image breaks.
Fix applied: generated all missing `-1600.webp` variants from the .jpg originals
(q82, effort 6). Verified 200 after fix.

### 2. [OPEN] Unknown product slug returns HTTP 200 with not-found UI
`/products/no-such-product` renders the not-found page but status is 200 (should be 404
for SEO). Same check for /collections/nope (200).

### 3. [WATCH] First hit on /l/<slug> gave empty reply once (000), then 302
Looks like a dev-compile hiccup, not reproducible on second hit. Watch in production logs.

### 4. [INFO] /returns/new → 404
No such route exists (app/returns has only page.tsx). Nothing in the UI links to it — OK.

### 5. [INFO] Blog has no seed posts → empty state renders fine (200)

## Not problems (checked)
- Raw SQL: only static identifiers or bound placeholders — no injection
- dangerouslySetInnerHTML spots are sanitized/validated (theme CSS, GTM id, pixel id,
  JSON-LD with `<` escaped, product description inline-escaped, size chart pre-sanitized)
- cartToast now uses textContent/img.src (fixed earlier)
- CSP header present (report-only until CSP_ENFORCE=1)
- No secrets in NEXT_PUBLIC_* (only NEXT_PUBLIC_SITE_URL)
- Server-side Meta Pixel base code present on all pages (verified /, /products, /cart, /blog)
