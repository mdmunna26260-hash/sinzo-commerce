# SINZO — Commerce Platform

A production-grade, fully functional e-commerce platform (customer storefront + admin panel) built for real Bangladeshi online business — following the MASTER PROMPT specification (Shopify-level feature set, phased build).

> **Status: Phase 1–5 of 13 delivered and verified end-to-end.** Core commerce loop (browse → cart → COD checkout → order → admin fulfilment → customer tracking) works against a real database. Integrations (Steadfast, Meta Pixel/CAPI, GA4, GTM) have **real implementations with honest "Not Configured" states** — nothing is faked, per spec §80.

---

## Quick start

```bash
npm install          # installs deps + prisma client
npm run db:push      # create SQLite database (dev)
npm run db:seed      # seed settings, admin users, 10 products, categories, coupons
npm run dev          # http://localhost:3000
```

- **Storefront:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin

### Default admin credentials (from MASTER PROMPT §49)

| Role        | Email                  | Password          |
| ----------- | ---------------------- | ----------------- |
| Super Admin | `Sinzo.bd@gmail.com`   | `do you love me?` |
| Order Mgr   | `orders@sinzo.com.bd`  | `order@123`       |

> ⚠️ **Change these immediately** (Admin → Team) before real use.

---

## What works right now (verified by `npm run test` — 20/20 checks)

### Customer storefront
- Premium minimal fashion design, mobile-first, announcement bar, sticky header, search with autocomplete
- Home: hero, value props, featured collection, category tiles, promo banner, best sellers, reviews, newsletter
- Product listing: search, category/price/size/availability/on-sale filters, sorting
- Product page: gallery, variants (size/color) with per-variant stock, size chart modal, quantity, add-to-cart, buy-now, wishlist, reviews + review submission, related products, sticky mobile add-to-cart, ViewContent tracking
- Collections pages (`/collections/best-sellers`, `new-arrivals`, `sale`)
- Cart: quantities, free-shipping progress bar, coupon validation, order summary
- **COD Checkout**: name/phone/address validation (BD mobile regex), Inside/Outside Dhaka zone with admin-configurable fees, order notes, coupons, fraud screening, server-side price & stock verification (client prices are never trusted)
- Order confirmation page with order code, **public order tracking** (code + phone → status timeline)
- Guest wishlist (localStorage), newsletter subscription, 404 page, sitemap.xml, robots.txt, manifest (PWA-ready)

### Admin panel (`/admin`)
- **Secure login**: bcrypt hashes, HMAC-signed httpOnly session cookie, rate limiting (8 attempts/10 min), role-based permissions (6 roles), case-insensitive email
- **Dashboard**: today/7-day/all-time sales, orders, AOV, pending/delivered/cancelled, customers, low stock, 14-day sales chart, top products, recent orders
- **Orders**: search & filters, bulk status update / delete, CSV export, order detail with status & payment updates, customer edit, admin notes, **printable invoice**, risk badge with flags
- **Steadfast courier**: send order → real consignment creation, refresh courier status, stored consignment ID/status; clear `NOT CONFIGURED` warning until API keys are set (Admin → Settings → Courier)
- **Products**: full CRUD in a modal editor — pricing (price/compare/cost), stock + low-stock alert, SKU, variants grid, image upload (stored locally, replaceable), category, tags, featured, status, view counts, CSV export
- **Categories & Collections** management
- **Coupons**: percent / fixed / free-shipping, min order, max discount, usage & per-customer limits, date windows, first-order-only
- **Customers**: aggregated from real orders (orders, spent, cancellations), segmentation (New/Returning/VIP/Risky)
- **Reviews**: moderation queue (approve/reject/delete)
- **Marketing**: abandoned checkouts with recovery rate, order sources (Facebook/Instagram/Google/Direct/Organic via UTM + fbclid capture), subscribers
- **Tracking & Pixels**: Meta Pixel + CAPI status, event stream (last 40 events with pass/fail + errors), **Send Test Event** button; GA4 ID, GTM ID config
- **Settings center**: store/brand, theme (colors, fonts, radius — applied live via CSS variables), homepage content (hero, promo, announcement, featured collection), **delivery fees**, Steadfast credentials, checkout toggles, fraud rules, blacklist (phone/IP/address), SEO, maintenance mode (admins bypass), audit log of sensitive actions

### Tracking architecture (spec §19–23)
- Centralized client `trackEvent()` → Meta Pixel + GA4 + GTM dataLayer + server CAPI forward, **same `event_id` everywhere for deduplication**
- Server-side **Meta Conversions API** with real Graph API calls, user-data hashing (phone/external_id), fbp/fbc/IP/UA capture, test event code support — and honest failure logging when unconfigured
- Purchase event fires server-side on order creation and client-side at checkout with matching event ID

### Fraud protection (spec §29, basic)
- Per-phone order velocity, cancellation history, blacklist checks (phone/address/IP), risk level (LOW→CRITICAL) stored per order; CRITICAL orders rejected; HIGH orders held for review; admin override always available

---

## Tech stack

- **Next.js 14 (App Router) + React 18 + TypeScript**, zero-UI-library custom CSS design system
- **Prisma ORM** — dev: SQLite (`prisma/dev.db`, zero setup) · production: change `provider` to `"postgresql"` in `prisma/schema.prisma` + set `DATABASE_URL` (Docker compose included)
- **Auth**: bcryptjs + HMAC-signed cookies (no external auth service needed)
- **Validation**: zod-grade manual validation on all API inputs; secrets never sent to the browser (masked in settings UI)

## Project structure

```
prisma/schema.prisma      21 models (see spec §59)
prisma/seed.js            realistic demo data
lib/                      db, auth+RBAC, settings engine, CAPI, steadfast, risk, audit
app/api/                  30 REST endpoints (public + admin, permission-guarded)
app/                      storefront (home, products, pdp, cart, checkout, track, wishlist)
app/admin/(panel)/        13 admin pages behind session guard
components/               storefront chrome, cart/tracking services, admin sidebar
scripts/smoke.js          end-to-end smoke test (npm run test)
Dockerfile + docker-compose.yml   VPS deployment (PostgreSQL + Redis)
```

## Production deployment (VPS)

```bash
# 1. clone + configure
cp .env.example .env   # set DATABASE_URL (postgres), SESSION_SECRET, SITE_URL, keys
# 2. switch prisma provider to postgresql, then:
npm run db:migrate && npm run db:seed
npm run build && npm run start
# or: docker compose up -d --build   (app + postgres + redis)
```

Put Nginx in front for TLS. Uploads persist to `public/uploads` (mount as volume).

## Honest gaps (next phases, per MASTER PROMPT build order)

- **Phase 6 remainder**: theme **homepage section builder** (drag/reorder — currently settings-driven homepage), custom page builder, blog/CMS
- **Phase 7**: full fraud rules UI (velocity rules configurable — engine already runs)
- **Phase 9**: advanced analytics (funnels, cohort/LTV reports — data already captured via TrackingEvent/attribution)
- **Phase 10**: notification senders (email/SMS/WhatsApp providers — abstraction point: `lib/capi.ts` pattern; templates table pending)
- **Phase 11**: customer accounts & login (orders currently tracked guest-style by phone+code), PWA service worker
- **Phase 12/13**: test suite expansion beyond smoke, i18n scaffolding

## Security notes

- All admin APIs require a valid session **and** role permission; storefront APIs validate every input
- Prices, stock, discounts, delivery fees are computed **server-side only**
- Secrets (Steadfast keys, Meta token) are masked in UI responses and stored in DB/env — never shipped to the client
- Login is rate-limited; passwords hashed; sessions expire in 7 days
