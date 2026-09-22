# SINZO — audit fix log (2026-09-15)

Repo: `mdmunna26260-hash/sinzo-commerce` @ `f980950` (prod). Branch: `fix/audit-2026-09-15`.
Everything below was reproduced and re-verified against a real running instance in the sandbox
(SQLite dev DB seeded with the same data quirks production has: UPPERCASE titles with trailing
spaces, a misspelled category slug, an empty category, a wrong `whatsapp` format).

## 1 · Storefront search was broken on production only

**Root cause.** Prisma `contains` → `LIKE`. On PostgreSQL (Neon/prod) `LIKE` is
**case-sensitive**; on SQLite (dev) it is case-insensitive. Product titles are stored UPPERCASE,
so every lowercase query missed. On top of that the whole query was matched as ONE literal
string, so typing a product's full name (`white shirt`) matched nothing.

That is why nobody saw it in dev. `app/api/admin/global-search/route.ts` had the opposite
problem: it used `mode: "insensitive"` unconditionally, which Prisma **rejects on SQLite**
(`Unknown field 'mode'` → that admin search crashes in dev).

**Fix.** New `lib/search.ts`:
- `supportsInsensitive()` — true only when `DATABASE_URL` is `postgres…`
- `ci(value)` — `{ contains, mode: "insensitive" }` on Postgres, plain `contains` on SQLite
- `terms(q)` — strips punctuation, splits on whitespace, drops <2-char noise, caps at 6 terms
- `productSearchWhere(q, fields)` — **AND over terms**, each term OR'ed across
  title/tags/sku/shortDesc/description/category
- `clean(s)` — collapses the DB's trailing/double whitespace

Applied to: `/api/search`, `/products?q=` (storefront), admin product picker, admin color-groups,
admin global-search. `/api/search` additionally: clamps `q` to 80 chars, and when nothing matches
it returns the popular rail with `noResults: true` so the search sheet never dead-ends.

**Verified.** `beige`, `black`, `beige color`, `lather jacket`, `leather` now resolve;
unknown/garbage terms return no rows instead of the whole catalogue.

## 2 · Category menu link opened an empty page

`/products?category=leather-jacket` rendered **0 products** while the jacket existed, and any
**unknown** `?category=` value was silently ignored → it showed ALL products (so a typo'd link
looked like a bug and every `?category=` URL in the sitemap was a duplicate of `/products`).

**Fix.** `resolveCategorySlug()` + `CATEGORY_ALIASES` in `lib/search.ts` resolve both directions
(`straight-fit ⇄ stright-fit`, `leather-jacket ⇄ lather-jacket`, `flame ⇄ falme`, `wide-leg ⇄
wide-leg-t-shirt`), so renaming a category in admin **never breaks an existing link** — including
the ones already printed in Facebook ads. Unresolvable slugs now produce the real empty state
("Nothing here yet" / "No such category") instead of an unfiltered catalogue. Pills always show a
count (`(0)` when a category is empty — previously an empty category rendered with no count at
all, which is how the mismatch hid itself).

## 3 · Catalogue data repair — `scripts/fix-prod-catalog.js` (new)

Dry run by default, idempotent, prints the whole plan before writing anything:
trims whitespace in title/shortDesc/description/tags, fixes category slug+label spellings,
corrects `LATHER→LEATHER` / `FALME→FLAME` in titles (slugs only with `--slugs`, so ad links don't
break), assigns products to their own empty category, fills the empty `/collections/sale` from
`comparePrice`, clears `store.instagram` when it holds a facebook.com URL, and sets a homepage meta
title when it's blank.

```
node scripts/fix-prod-catalog.js            # read-only report  ← run this first
node scripts/fix-prod-catalog.js --apply    # write
```
Step 4 requires **every** word of the category name to match, so "Leather Jacket" matches
"LEATHER JACKET" but not "Tan Leather Tote" (verified — an earlier version of the heuristic did
misfile that bag; fixed and re-run).

## 4 · Admin session token was being put in a URL

`tokenFromRequest()` accepted `?t=<token>`, and the storefront header built
`/admin/dashboard?t=<token>` for logged-in admins. A token in a URL is a token in browser
history, nginx access logs and `Referer` headers.

**Fix.** `lib/auth.ts`: the `?t=` path (and handing the JWT to JS in the login response) is now
**off in production** — the httpOnly `sz_session` cookie is the only production path. Opt back in
with `AUTH_URL_TOKEN=1` for embedded previews. The header no longer appends the token to the link.

**Also fixed (worse than it looked):** `SESSION_SECRET` fell back to the literal
`"dev-secret-change-me"` from a **public** repo (`sinzo` was public on GitHub). Anyone reading the
source could mint a `SUPER_ADMIN` token. Now: in production a missing/default secret is refused and
replaced with a per-boot random secret + a loud error log, so nobody can forge; dev keeps a stable
default. **Set `SESSION_SECRET` in Dokploy → Environment** (otherwise every deploy logs the admin
out).

## 5 · Public order tracking was an enumeration key

`GET /api/track/courier?code=…` accepted an order code (`ORD-1001`, `ORD-1002`… — sequential and
therefore guessable) with **no second factor** and returned the order's items, area and status. A
bare phone number also returned everything. It additionally loaded the last **500 orders** and
`JSON.parse`d each row *per request*.

**Fix.** `ORD-…` codes are honoured only together with the order's mobile number (same rule as
`POST /api/track/order`); a phone-only lookup returns **status only** (no item list) and says so;
consignment/tracking IDs stay single-field (long, courier-issued, already on the parcel); lookups
are now indexed `where` clauses instead of a 500-row scan; per-IP limit 30/min → 15/min; error text
is English and generic. `app/track/client.tsx` gained the mobile-number field the API now wants,
plus honest copy — it previously promised "Tracking number, Consignment ID, Order code ba Phone
number — jekono ekta dilei cholbe" (either one is enough), which was not true of the server.

> **Update 2026-09-16 — see §11:** the owner asked to see *what was ordered* from a phone-number lookup,
> so the phone-only path now returns items again, bounded by a per-number throttle and by never
> returning name/address/notes. The rest of §5 (no code-only lookup, indexed queries) still stands.

## 6 · Cache headers: storefront was uncachable, everywhere

`next.config.mjs` set `private, no-store, must-revalidate` on **all** HTML (the comment explains
why: a deploy that renames `/_next/static/*` chunks leaves visitors on stale HTML). The trade was
too blunt — every page view on a single VPS re-rendered.

**Fix.** Storefront (`/`, `/products`, `/products/*`, `/collections/*`) →
`public, max-age=0, s-maxage=60, stale-while-revalidate=300, must-revalidate`. `max-age=0` keeps
the **browser** revalidating (so the stale-chunk crash they were guarding against still can't
happen), while a CDN/proxy can serve for 60s and refresh in the background. `/cart`, `/checkout`,
`/account`, `/login`, `/admin*`, `/api/*` stay `private, no-store`.

Verified: `Content-Security-Policy-Report-Only`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`
sent; `Strict-Transport-Security` gains `; preload` in production; `www.` → apex `308` redirect
added (both hosts previously served identical content, splitting cookies and PageRank).

> ⚠️ `s-maxage` only pays off once a shared cache is in front (Cloudflare in front of Dokploy is
> the 10-minute version). Nothing here makes the site slower — it just stops forbidding caching.
> `/api/media/*` keeps the 1-year `immutable` header the route itself sets (deliberately NOT
> overridden in config, which would have downgraded it to 30 days).

## 7 · SEO / social

- **Canonical**: none existed anywhere in the codebase. Added on `/`, every PDP, every collection.
- **metadataBase**: only set when `NEXT_PUBLIC_SITE_URL` existed; if unset, every absolute
  og:url/og:image silently disappeared. Now falls back to `https://sinzooffcial.com`.
- **PDP `generateMetadata`**: rewrote — `clean()`ed title (was `"LATHER JACKET "` → a double space
  in the browser tab), real 155-char description instead of a raw slice with leading `\n`,
  `og:type/url/site_name/locale`, and the **w1200 share image** instead of the full-resolution
  original (Facebook cropped it; mobile users downloaded ~1 MB).
- **Structured data**: `/` had zero JSON-LD → added `Organization` + `WebSite` with
  `SearchAction` (sitelinks search box). PDP `Product` now emits `PreOrder` availability (was
  `OutOfStock` for pre-order items, which is what Google then showed), `priceSpecification` with
  `previousPrice` (strike-through now reaches rich results), `priceValidUntil`,
  `availabilityStarts` for pre-orders, `shippingDetails` and a 7-day `hasMerchantReturnPolicy`.
- **sitemap**: stopped publishing `/products?category=…` (duplicates of `/products`, and every
  unknown slug returned the full catalogue — i.e. free duplicate pages); collections got
  `changeFrequency`, `/track` too.

## 8 · Cart & checkout rendered the literal word "Loading…"

`/cart` and `/checkout` are client-mounted (cart lives in `localStorage`), so the server HTML said
`Loading…` and that was the entire page for no-JS/failed-Hydration visitors. Replaced with a real
skeleton (rows + thumb placeholders using the existing `.sk-img`/`.sk-line` classes) plus an
`sr-only` "Loading your cart…".

## 9 · Small but visible

- **`/collections/sale`** promised "Winter Sale — Up to 30% off selected styles" over an **empty
  grid**; it now renders an empty state that links to `/products?onsale=1`, and has real metadata.
- **WhatsApp/tel links**: `store.whatsapp` is `01576450711`; wa.me needs
  `8801576450711`, so every WhatsApp button opened an "invalid number" screen. New
  `waLink()`/`telLink()` in `lib/phone.ts` normalise (same rule the admin order screen already
  used). Verified: renders `wa.me/8801576450711` and `tel:+8801576450711`.
- **`favicon.ico` was a 404** that returned 19 KB of HTML on every visit → generated a real
  multi-size `favicon.ico` + `favicon-32.png` from `icon-512.png` and linked them.
- **Announcement bar** duplicated its text 4× into the DOM/screen-reader and Google's index (it's
  a CSS marquee). Track is now `aria-hidden` with one `sr-only` copy.
- **Login form**: inputs had no `name`/`autoComplete` → password managers couldn't save; added
  `tel`/`current-password`/`new-password` + label↔input `htmlFor`. The customer fallback cookie is
  now `Secure` over https.
- **`/products` was completely broken in dev** (`Unknown field 'preorder' for select statement on
  model 'Product'`) because `prisma/schema.prisma` had drifted from `schema.prod.prisma`
  (`preorder`, `preorderDate`, `soldMode`, `stockDeducted`). Dev schema synced — this also means
  `npm run dev` + `db:push` works again.
- **Admin write hygiene**: product create now `clean()`s title/shortDesc/description, so trailing
  spaces can't come back through the UI.
- **`/api/track/event`**: no size cap, no rate limit, any event name was written to the DB (a 1 MB
  POST returned 200). Now 16 KB cap → `413`, 120/min per IP, allowlisted event names, and throttled
  calls still answer 200 so a blocked analytics ping can't surface as a console error.
- **Banglish UI strings** ("Bhul password", "Track kora jacche na", "…jekono ekta dilei cholbe")
  replaced with English on customer-facing surfaces. Admin-only strings left alone.

## 9b · Customer login leaked which phone numbers have accounts (found while reviewing source)

`POST /api/auth/login` answered **"Account pay nai — age register korun"** for a number with no
account and **"Bhul password"** for a wrong password — a free oracle over Bangladesh's mobile-number
space (knowing who has an account at a clothing store is itself sensitive, and it names targets for
credential stuffing). The missing-account path also skipped `bcrypt.compare`, so it answered ~100×
faster (timing oracle). Verified fixed: both cases now return the identical
`Invalid phone number or password`, 101 ms vs 106 ms.

**Fix** — the pattern `app/api/admin/login/route.ts` already used: always run a bcrypt compare
(against a dummy hash when there is no account) + one generic message, plus a per-account throttle
(8/15 min) on top of the existing 10/10 min per-IP one. `/api/admin/login` was already correct and
was left as is — it also has no user-enumeration leak.

## 10 · `scripts/smoke.js` now guards all of this

Added regression checks that each failed before the fix (34 checks, 0 failures against a
`next build` + `next start` instance seeded with the same data quirks production has): lowercase + multi-word search, unknown
category must show the empty state, PDP canonical, no double space in `<title>`, no raw `undefined`,
Product JSON-LD present, **`ORD-` code refused without a phone number**, working with one, oversized
analytics payload → 413, media traversal blocked, CSP + nosniff headers sent. Run against any
instance with `BASE_URL=… npm test`.

## 11 · Tracking now lists the ordered items (and resolves a phone number)

Asked for by the owner: "order track — phone number, order id use kore dekha jabe and ki item
order korache seta o dekhha jabe."

**API.** `GET /api/track/courier` previously selected `items: { title, qty }` only, so the panel
could not show size/colour, unit price, line total, thumbnail, payment state or the money split.
The `select` is now `title, variant, image, price, qty, preorder, preorderDate` plus
`subtotal, discount, deliveryFee, total, paymentMethod, paymentStatus` on both the code+phone path
and a new phone-only path. `POST /api/track/order` got the same item/money fields so the two
endpoints cannot drift apart. The order-status label map and the tone rule were duplicated inline;
they are now `ORDER_LABEL` / `orderTone()` at module scope, used by both paths.

**Phone-only lookup** returns the newest order on that number with its items, and `otherOrders`
(the up-to-5 older codes with date + status) so the customer can tap into an older parcel. It is
throttled per number (6 lookups / 10 min) on top of the per-IP 15/min, and the row it builds never
includes `name`, `address`, `notes` or the phone itself. Measured: 7th lookup for the same number →
`429 Too many lookups for that number.`

**UI.** `app/track/client.tsx`: item rows (38×48 thumb through `imgSrc()` so the mobile variant is
used, title · variant, `Qty n · ৳x each`, right-aligned line total, pre-order date when set), a
totals block (subtotal / discount / delivery with inside-vs-outside Dhaka wording / bold total) and
a payment line mapped through `LABEL`/`PAY` ("Cash on Delivery · not paid yet"), plus the
`otherOrders` chips. Money uses the same `৳` + `en-IN` grouping as the account panel so a figure
never reads differently in two places. Field copy and placeholder now say a bare mobile number is
enough, because it is.

Verified against the running dev server with real rows in `prisma/dev.db`:
`ORD-1008+01812345678`, `01812345678` (6 orders → newest + 5 `otherOrders`), `01712345678`
(single delivered order, `paymentStatus: PAID`), wrong phone for `ORD-1008` → generic miss, no
phone → `{needPhone:true}`, `tsc --noEmit` clean, `/track` 200 and the compiled client chunk
contains the new markup. `next lint` is not usable here — the repo has no ESLint config, so
running it drops into an interactive setup prompt.

## 11b · `scripts/set-admin-password.js` (new) — because the seed cannot rotate a password

`prisma/seed.js` upserts the admin with `update: {}`, so re-seeding leaves an existing password
untouched — the standard way an owner ends up locked out of `/admin` after a redeploy. New script
`node scripts/set-admin-password.js '<pass>'` (also `npm run admin:passwd -- '<pass>'`) hashes with
bcrypt(10) exactly as the login route expects, refuses anything under 10 chars, creates the row if
it is missing, echoes no password, and re-`compare()`s the stored hash to prove login will work.
It reads `.env.local`/`.env` when `DATABASE_URL` is absent from the shell. It matches users the same
way `/api/admin/login` does — exact email, then a case-insensitive pass over active admins — because
the first version of this script used `findUnique` on a lower-cased email, missed the row stored as
`Sinzo.bd@gmail.com`, and quietly created a **second** SUPER_ADMIN instead of updating the first.
That fallback and a cleanup of the stray row are in. End-to-end: old pass 200 → set new → new 200 /
old 401 → restore → 200.

## 12 · iPhone: a product needed two taps, and the rails would not swipe (2026-09-22)

Reported from the owner's own phone: "home page ba product page ba you may also like section theke
product e click korle page open hoy na, 2 bar korte hoy" and "mobile e product swipe korle change
hoy na". Both were reproductions on a real device, so this entry is written to be read next time a
touch gesture misbehaves — each cause below is a *class* of bug, not a one-off.

**Why one tap did nothing (three causes, all removed).**

1. **Hover styling on a touch screen.** iOS honours the *first* tap on an element that has
   something to show on `:hover` — the tap becomes the hover and no `click` is synthesized, so the
   second tap is the one that navigates. Every hover rule in `globals.css` whose effect moves or
   repaints the thing under the finger (product card image zoom, collection tiles, `.qadd` circle,
   `.pdp-add`, review stars, blog images, …) is now inside `@media (hover: hover)`. Desktop is
   untouched; a phone keeps the plain, always-visible design.
2. **Double-tap zoom.** The viewport allows zooming (`maximumScale: 5`), so two quick taps can be
   read as a zoom instead of two clicks. Tappable elements now carry `touch-action: manipulation`
   — pan and pinch still work, double-tap-to-zoom is off. Card images also refuse the native image
   drag (`-webkit-user-drag: none`), which can eat the click the same way.
3. **Entrance animations were moving the tap target.** `.reveal` (JS/IntersectionObserver) and
   `.sdr` (scroll-driven `view()`) both slide their block up 16–18px while it enters the viewport
   — exactly when a shopper scrolls a row of products in and taps the first card. WebKit drops the
   click when the element under the finger has moved, so on touch devices both keep the fade and
   drop the movement (`@media (hover: none)`, §J2).

Also fixed while in there: `app/products/shop-layout.tsx` added its `document` click listener
without the capture flag but removed it with `capture: true` — the listener was never detached, so
one stale handler per visit to `/products` kept dimming (`pointer-events: none`) a grid that was
not updating.

**Why the swipe did nothing.** The rails relied on native horizontal scrolling with
`scroll-snap-type: x mandatory` and `touch-action: pan-x pan-y`, i.e. both axes left to the
browser. On a phone the first few pixels decide the axis: a slightly diagonal thumb swipe is read
as a page scroll and the rail never moves, and when the browser does take the rail, mandatory snap
can bounce it back to the page it started on. Now the horizontal axis is ours:
`components/swipe-rail.ts` (new, shared by the home rails and the PDP "related products" rail)
drives `scrollLeft` 1:1 with the finger, locks the axis after 6px, advances a page on 18% travel
or a 0.35px/ms flick, springs back otherwise, and swallows the click that follows a drag.
`touch-action: pan-y` in CSS keeps the vertical axis native, so the page still scrolls normally.
The repeated gesture machine is the one already proven in `card-gallery.tsx`; the decision itself
(`railTarget`) is pure and unit-tested. `card-gallery.tsx` also learned to swallow a click only
after a *horizontal* drag past 12px, so tap wobble can no longer cancel a tap.

**Verified.** `tsc --noEmit` clean · production `next build` exit 0 · smoke suite 59/0 against the
dev server · `railTarget` 16/16 (`scripts/_sandbox/rail-test.mjs`) · served CSS re-checked for
every gated hover rule, the `pan-y` rails and the touch reveal override
(`scripts/_sandbox/css-audit.mjs`) · home, `/products` and a PDP all 200 with the rails, related
carousel and 18 product cards rendering. What a sandbox cannot prove is the iPhone itself: the
gesture/hover heuristics above only exist in WebKit on a touch screen.

## NOT changed — deliberately

- **Checkout pricing**: `POST /api/checkout` already re-loads products and re-prices server-side
  ("never trust client prices"), enforces per-variant stock, runs in a `$transaction` with atomic
  coupon consumption, and rate-limits. My audit note asking to verify this is **closed — it is
  correct**. One dead branch: `SoldOutError` is caught but never thrown; the `class SoldOutError`
  block and its `if (e instanceof SoldOutError)` are unreachable (harmless).
- **Stock decrement at delivery** (Steadfast flow) left as designed.
- **Role/permission model**, audit log, bcrypt dummy-compare (no user-enumeration timing leak) —
  already good.
- No database was touched in production; no deploy was triggered.
