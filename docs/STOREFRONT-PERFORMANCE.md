# Targeted storefront optimization

## Scope

Keep the existing design, mobile gestures and advertising event behavior. No dependency updates, tracking delays, image-quality reductions, production database changes or deployment are included.

## Changes

- Move 513 admin-exclusive CSS rules (including nested responsive overrides) from `app/globals.css` into `app/admin/admin.css`, imported by the admin parent layout. Preserve source order within each stylesheet. Shared primitives, account status pills and keyframes remain global. The admin parent also covers sign-in pages.
- Render each homepage shelf's product cards once. Mobile retains four-card swipe pages; desktop flattens the page wrappers with `display: contents` into the same responsive grid. Category carousels and their desktop editorial grid are deliberately unchanged.
- Make priority `SmartImg` images visible in server HTML, without waiting for a hydration effect/load handler to add the `loaded` class. Keep eager/high-priority responsive loading. Non-priority images retain the decode fade and lazy loading. Empty width lists no longer throw.
- Use existing responsive variants for recently viewed thumbnails, with sizes matching 140px regular, 142px mobile homepage and 170px desktop homepage placements. Preserve cache-busting queries in media srcsets.

## Local production-build measurements

These are local build assets, not live PageSpeed transfer figures or speed scores. Gzip sizes use Node zlib defaults.

| Storefront stylesheet | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Minified bytes | 203,627 | 152,422 | 25.1% |
| Gzip bytes | 39,701 | 30,828 | 22.4% |

The separate admin stylesheet is 53,591 minified bytes / 10,259 gzip bytes and is not linked on storefront pages. Local homepage data rendered 40 shelf product-card instances instead of 80. This is not a claim that the whole page's DOM or JavaScript bundle is halved.

## Validation

- `npm run check`: typecheck passed, 253 unit tests passed, touch audit 55 passed / 0 failed.
- Optimized Next build passed using the sandbox PostgreSQL adapter preload and `NEXT_DIST_DIR=.next-prod`. A normal deployment build against production Neon was not run here.
- Chromium: compare original global CSS against extracted CSS on home, products, admin login/orders/dashboard/products editor/settings/stock, account, cart and checkout at 390px and 1280px. Compared computed layout/design properties across page elements after font loading; no differences observed.
- Chromium: compare the single-tree shelf with reconstructed old mobile/desktop markup at 320, 390, 760, 899, 900, 992, 1080, 1280 and 1600px. Shelf/card geometry matched at every width.
- Chromium: Next/Previous buttons, actual touch swipe in the product shelf's row gap, desktop/mobile resize, finite page indicators, and storefront-only stylesheet delivery passed. No browser runtime errors in this interaction check.
- Chromium with JavaScript disabled: first hero image has opacity 1, eager loading and high fetch priority.
- Tracking components, GTM/Pixel loaders, CAPI/event endpoints, event IDs, payloads and firing timing were not modified. External requests were blocked in the browser checks; this is not an end-to-end Meta/Google delivery verification.
- Package manifests/lockfile unchanged. No push/deployment performed.

## After deployment

Repeat mobile PageSpeed on `/` and `/products`, preferably several runs under the same test conditions. Compare LCP/FCP, CSS delivery and image diagnostics to the supplied baseline (performance 78 on both pages; homepage LCP 4.9s). Verify PageView, ViewContent, AddToCart and Purchase in the existing tracking QA workflow. Do not disable or postpone ads tracking just to remove third-party cache/unused-JS warnings. Third-party Facebook cache headers remain outside this application's control.
