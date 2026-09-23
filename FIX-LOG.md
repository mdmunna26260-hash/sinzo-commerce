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

## 13 · Photo pagination dots under the image (home · products · PDP) + progress bar off on mobile (2026-09-22)

Owner's reference (a PacSun-style card): one dot per product **photo**, placed **under** the image,
the current one bigger and dark, the rest small and light, updating as you swipe. Minimal, no
animation beyond a short colour/size transition.

- **Cards (home rails, `/products` grid, "you may also like")** — the dots used to be painted on
  top of the photo (5px white / 14px white pill, `.cg-dots`). `.pcard-img` clips its content
  (`overflow: hidden` — the sliding track needs it), so the row cannot live inside the gallery
  either: new `components/card-media.tsx` owns the media block, `CardGallery` reports its index up
  (`onIndexChange`) and the wrapper draws `.pcard-dots`. The row is absolutely positioned inside the
  14px `.pcard-info` already leaves above the title, so a card with several photos is exactly as
  tall as its single-photo neighbours and grid rows never go ragged.
- **PDP (mobile)** — `.mgal-dots` also floated over the photo (7px / 20px dark pill). It is now a
  normal row between the image and the thumbnail strip with the same sizes as the card dots
  (6px / 9px), and its hit area is trimmed from ±19px to ±13px so it can overlap neither the photo
  above nor the thumbnails below. One photo renders no dots (the counter chip covers that case).
- **Related rail** now receives the product's whole photo list (6-photo cap, same as the grid)
  instead of only the cover, so its cards can carry dots and the drag gallery too.
- **Rail dots** (`.crs-dots`) keep their job but adopt the same language — the active page is a
  bigger dark dot instead of an 18px pill, the inactive ones are lighter.
- **Dark theme** — the dots now sit on the page background, so the old "dark dots for the light
  image mat" override is inverted: inactive dots flip to `rgba(255,255,255,.26)`, the active one
  stays `var(--text)` (light in dark mode).
- **Progress bar** — `.scroll-progress` is hidden below 900px (the storefront's mobile split) on
  request: on a phone the 2px line only read as a broken bar under the status bar. Desktop keeps it.

Verified: `tsc --noEmit` clean · production `next build` exit 0 · smoke 59/0 · served HTML and CSS
re-checked against a dev product carrying three photos (home: 4 dot rows + 4 drag galleries,
`/products`: 1 + 1, PDP: dots in flow under the image and before the thumb strip). Those two extra
photos live in `public/uploads/demo/` and exist only in this dev DB — `public/uploads/*` is
git-ignored, so nothing about them ships.

## 14 · PDP desktop dots below the image — and the "Hydration failed" scare (2026-09-22)

**a) The dev-preview error was a stale build, not the dots.** The owner saw *"Hydration failed
because the initial UI does not match what was rendered on the server"* (1 of 2 errors) plus the
storefront's Oops card. The crash reporter (every `app/error.tsx` / `components/safe-section.tsx`
failure POSTs to `/api/client-error` → `AppLog` + `TrackingEvent`, i.e. Admin → Logs / Tracking)
had two rows at 16:07:58:

```
section featured:    Cannot read properties of undefined (reading 'call')
section bestsellers: Cannot read properties of undefined (reading 'call')
  at options.factory (…/_next/static/chunks/webpack.js:715)
```

That is the webpack runtime failing to find a module factory — the chunk *loaded* fine, the module
id inside it no longer exists. It matches the dev-server log for the same window, where a
production `next build` had just run over the `.next` of the **live** dev server (500s from
`webpack-runtime.js`). A prod build overwrites the dev server's webpack runtime, so the open tab
receives an HTML/JS pair that cannot hydrate → overlay error + root error boundary + the two
section fallbacks (the sections legitimately disappear because `SafeSection` caught it). After
`rm -rf .next` + restart the same browser went on to load `/`, `/products`, a PDP and `/cart` with
zero further reports — no dot markup was involved.

- **Hardening**: the layout's recovery script only watched for *failed* chunk requests; this
  failure is a request that succeeds and then throws. It now also matches the webpack signature
  above, reports it (with the bundle filename) to Admin → Logs, and reloads once with the
  cache-busting `_r` — same one-per-session guard, so a reload loop is impossible.
- **Ops note**: never run `next build` while a dev server owns that `.next`. Stop the dev server
  first, then wipe `.next` before starting it again (second time this has hit; the first was the
  same-day `MODULE_NOT_FOUND './8948.js'`).

**b) Desktop PDP dots now sit under the image too** (owner: *"PDP-র ডেস্কটপেও ছবির নিচে একই ডট"*).
They used to be white pills floating over the bottom of the photo (8px, active 20px wide with a
4px radius). They are now the same row as everywhere else — one 6px light dot per photo, the
current one 9px and `var(--text)`, only a `.18s` colour/size transition.

- `.pdp-gallery-desktop` is `display: contents`, so the row is a grid item of `.pdp-gallery`
  (`72px` thumbs | photo): `grid-column: 2; grid-row: 2` puts it exactly under the photo while the
  thumbnail rail keeps column 1 — the same reading order as mobile (photo → dots → thumbs).
- Desktop means a pointer, so these stay real `role="tab"` buttons (click to jump, Tab + Enter
  works, visible focus ring); on the cards the dots stay decorative because the whole card is one
  `<a>`. `::after { inset: -10px -6px }` grows the 6px hit area without touching the photo above or
  the thumbnails below.
- Dark theme picks the desktop dots up with the others (inactive `rgba(255,255,255,.26)`).
- Deleted a leftover liquid-glass override (`rgba(20,20,20,.18)` + `backdrop-filter:none`) that was
  written for the over-the-photo dots and silently fought `.mgal-dots`' own alpha.

Verified: `tsc --noEmit` clean · production `next build` exit 0 · smoke 59/0 · served HTML on the
3-photo dev product reads `mobile gallery → main image → gal-dots (3 buttons, 1 active) → thumbs` ·
served CSS carries the new `.gal-dots` rules, the old absolute/white-pill rule and the stale
override are gone · all 5 inline scripts pass `node --check` · dev DB back to baseline (ORD-1001
only, WaMessage 0).

## 15 · The preview's "Oops" card, for real — self-healing that repeats (2026-09-22 late)

The owner's screenshot showed the storefront's Oops card while every server check returned 200
(`curl` on all routes, and the whole smoke suite). The crash reporter had the answer again:

```
16:21:02  stale bundle: … (reading 'call') @ webpack.js?v=1790094056174     ← the §14 monitor
16:21:02  section featured / bestsellers: … (reading 'call')
16:21:06  after the automatic _r reload   section featured / bestsellers: …   url "/?_r=…"
16:26:12  clean .next, fresh load         section featured / bestsellers: …
```

The stack is the tell — it is **not** a failed request:

```
mountLazyComponent → readChunk → initializeModuleChunk → requireModule → __webpack_require__ → options.factory (undefined)
```

The Flight payload asks for a module whose chunk the client runtime *already believes* is installed.
`next dev` reassigns which module lives in which chunk on every recompilation (each newly compiled
route, each edited file), so a tab that loaded a page before a recompile asks for a chunk it will
never re-fetch and the module is simply not in it any more. Measured with a probe: chunk **files**
stay byte-identical across compiles (`app-pages-internals.js` md5 unchanged after compiling four more
routes) and only the build id moves — so it is the client's in-memory chunk → module map that goes
stale. That is why no amount of curl/SSR checking can see it, and why only a reload fixes it. The two
sections that fail are the ones whose client components are lazily mounted (`Carousel` + the cards
inside it); the same code path is what a deploy produces in a phone's tab (see `app/error.tsx`).

**Why the card stayed on screen**: both recovery paths were one-shot *per tab*.
- the layout's chunk-error script started with `if (sessionStorage.getItem("sz_chunk_err")) return;`
  — it had already healed the tab once at 16:21:02, so every later failure was ignored;
- `app/error.tsx` started with `if (!attempts.includes(key))` — the key was already recorded, so the
  boundary rendered the card and never retried.

**Fix — same idea in both places, a time-based budget instead of a session-wide flag:**
- `app/layout.tsx` recovery script: one reload per minute, at most five per tab, and every occurrence
  is still reported to `/api/client-error` (that report is how this was diagnosed). It now matches the
  webpack signature (`Cannot read properties of undefined (reading 'call')`) and not just failed chunk
  requests / import rejections, and it exposes `window.__szHeal` for other components.
- `app/error.tsx`: up to 3 reloads per error, never two inside 15 s, and an attempt stops counting
  after 10 minutes — a tab that lives through a later deploy heals again instead of sitting on the card.
- `components/safe-section.tsx`: when a *section* dies from the same bundle error, it asks the root
  script to heal, so a half-empty page recovers by itself instead of staying half-empty.

**Executable verification** (runs the real string out of `app/layout.tsx`):
`node scripts/_sandbox/heal-test.mjs` → **8/8** — heals a stale bundle, keeps the `_r` cache-buster,
refuses a second reload inside a minute, reloads again after one, caps at 5 per tab, and still reports
every failure. Plus `tsc --noEmit` clean · production build exit 0 · smoke 59/0 · the served bundles
carry the new logic (`app/error.js` → budget + TTL, `app/page.js` → the heal hookup), and all inline
scripts pass `node --check`.

**Ops notes** (both now recorded): never run `next build` while a dev server owns that `.next`; and
after any restart/rebuild the open tabs must reload — the dev-only watchdog does that automatically
for the preview (that is what clears the card without anyone clicking).

## 16 · Why the product page kept falling into the Oops card — the "immutable" dev chunks (2026-09-22 night)

Root cause, with a one-line proof:

```
$ curl -sI http://127.0.0.1:3001/_next/static/chunks/app-pages-internals.js
Cache-Control: public, max-age=31536000, immutable
```

That header came from **our own** rule in `next.config.mjs` (`source: "/_next/static/:path*"`), written
on the production-only assumption in its comment — "hashed filenames". In `next dev` the filenames are
**not** hashed (`app/page.js`, `app-pages-internals.js`, `main-app.js`, `not-found-boundary.js`,
`redirect-boundary.js` …) and their **content changes on every recompile**. So any browser that touched
the dev preview cached those chunks **for a year and never revalidated**:

- after a rebuild (or `rm -rf .next`) the browser kept the old copies while the fresh HTML/flight
  payload expected the new ones → webpack `options.factory` undefined → sections disappeared, then the
  route fell into `app/error.tsx` → the Oops card;
- only the two chunks referenced as `…?v=<build id>` were ever re-fetched (their query changed);
  everything else came out of the year-long cache. That is why **reloads did not help — not even the
  automatic `_r` ones added in §15** — and why it hit `/` and `/products/[slug]` in the browser but
  never in `curl`.

**Fix**
- `next.config.mjs`: the static-asset rule is now environment-aware — `immutable, max-age=31536000`
  **only in production** (where Next hashes the names) and `no-store, must-revalidate` in development.
  Verified by curl: dev chunks (with and without `?v=`) answer `no-store`; prod chunks answer
  `immutable` and every URL carries a content hash.
- The preview now runs from a **production build**, so the poisoned URLs can never be reused. A new
  `distDir` override (`NEXT_DIST_DIR`, default `.next` — Docker/deploys untouched) lets `npm run build`
  write `.next-prod` **without touching the dev server's `.next`** (sharing one directory is what
  corrupted builds in §14). Preview = `NEXT_DIST_DIR=.next-prod next start -p 3001`; the dev server
  used for smoke runs moved to `:3002`. Because production chunk names are content-hashed
  (`loading-9745a1ccd6968308.js`), a browser holding the old unhashed URLs simply never asks for them
  again — no cache clearing needed on the owner's side.
- `.gitignore`: `.next-prod`.

**Test order** (owner's request) — placed through the production preview's own API with the exact
payload the checkout page sends:

```
POST /api/checkout → 200 {"ok":true,"code":"ORD-1006","total":970,"risk":"LOW"}
  Order      ORD-1006 · COD · subtotal 890 + delivery 80 = 970 · INSIDE_DHAKA · PENDING · customerId 6
  OrderItem  Relaxed Heavyweight Tee (variant #34, S/White) ×1
  Customer   "Test Customer (Arena)" 01700000099 created
  WhatsApp   AUTO order-confirm QUEUED → 8801700000099 (no device connected in this sandbox)
  Tracking   POST /api/track/order {code, phone} → 200 · PENDING · ৳970 · 1 item
  Success    /order/success?code=ORD-1006 renders the confirmation + invoice link
  Admin      login 200 · order visible in /api/admin/orders (list + detail), status PENDING
  Stock      unchanged on purpose — this design deducts stock at DELIVERY (stockDeducted stays false)
```

Verified: `tsc --noEmit` clean · production build exit 0 · smoke **59/0** (run against the dev server)
· preview pages 200 with hashed chunk URLs · dev + prod cache headers checked by curl. The §14/§15
self-healing stays (it is what saves a real deploy in an open tab); with the cache actually fixed it
should stop being needed in dev.

## 17 · "You may also like" could not be swiped at all — and the tap path, second pass (2026-09-22, later)

The owner's phone still showed the §12 symptoms: *"home page ba product page ba you may also like
section theke product e click korle page open hoy na, 2 bar korte hoy"*, *"mobile e product swipe
korle change hoy na"*. §12 fixed real causes (hover-first taps, double-tap zoom, `.reveal` moving
the tap target, native-scroll rails) — this pass found one that nothing had touched, and it is
reproducible in a desktop browser, no iPhone required.

**a) The PDP's "you may also like" rail had no gesture handler at all.** `app/products/[slug]/page.tsx`
rendered its own `.rel-carousel > .rel-scroll > .rel-page…` markup inline (server component, no
hooks) while `components/related-carousel.tsx` — the component written to own that rail, with the
swipe machine behind it — was only used by the throwaway harness. `.rel-scroll` carries
`touch-action: pan-y`, i.e. the browser is explicitly told **not** to pan it horizontally, so with
nothing in JS the rail could not be moved by touch at all: swipe = nothing, tap = the card opens
(hence "product swipe korle change hoy na" in that section specifically).

Evidence (Chrome DevTools protocol, `DOMDebugger.getEventListeners`, phone emulation):

```
.crs-track (home rail)  → scroll, touchstart, touchmove, touchend, touchcancel, pointerdown, dragstart
.rel-scroll (PDP rail)  → scroll          ← React's onScroll only; no touch listeners at all
.cg (card gallery)      → touchstart, touchmove, touchend, touchcancel, pointerdown, dragstart
```

Fix: the PDP renders `<RelatedCarousel items={…} dots />`. Same classes, same 2×2 pages, same bare
dots; the component now also forwards `preorder`/`sizes` to the card, so the cards look identical to
the desktop grid next to them, and it flattens the row's `images` (`{url}[]`) to URLs — passing
strings straight through made every related card fall back to the single-photo `CardImg`, i.e. it
lost its gallery and its dots.

`.rel-dots`/`.rel-dot` had no CSS rule anywhere in the repo: the spans rendered zero-sized, so the
rail showed no sign of having more than one page. They are styled now like the dots already used on
the card photos (`.pcard-dots`) and the home rails (`.crs-dots`), and they follow the page as you
swipe. `RelatedCarousel` clamps `goTo`, keeps two pages of slack off the DOM for huge categories
(`cap`), and the arrows path stays available for callers that want the counter chrome instead.

**b) One gesture machine, one place to look.** `components/use-swipe.ts` is now the only drag
engine, shared by `card-gallery.tsx` (card photos) and `swipe-rail.ts` (home rails + the PDP rail).
Its rules, all of them written against WebKit's touch behaviour: touch events with a **non-passive
`touchmove`** (React attaches `touchmove` passively at the root, so `preventDefault` from a React
handler is a no-op); the drag is taken from the browser (`preventDefault`) the moment the axis is
decided horizontal, so nothing is left to cancel mid-gesture; vertical intent is handed straight
back and is never prevented, so the page still scrolls naturally over a photo; no
`setPointerCapture` anywhere (it retargets the click after a tap, and iOS 13–15.4 ignored touch
capture entirely); a `touchcancel` (call, notification, pinch, system gesture) releases the gesture
with the distance already travelled instead of rewinding it; and the click that follows a *drag* is
swallowed in the capture phase, while a *tap* is never swallowed — a swipe can never open the PDP
and a single tap always can.

The CSS side of the same wound: `.pcard-badges` (the sale / TRENDING chips) sits at the top-left
of the photo as a **sibling** of the gallery, so a thumb landing on a chip reached neither the
gallery nor — for a rail — anything that could page it. The row is decoration on a link that already
handles the tap, so it is `pointer-events: none` now: the gesture goes to the photo underneath it,
and a tap still opens the product.

**c) The single-photo card's touch intent no longer renders mid-tap.** `components/card-img.tsx`
warmed the image and called `router.prefetch()` from `onTouchStart`; the prefetch is a router-state
update, i.e. a React render between `touchstart` and the click the browser is about to synthesize —
the same "the tree under the finger changed, so WebKit drops the tap" pattern as §12's `.reveal`
fix. The image warm still happens immediately (network only, detached `Image()`), the prefetch is
deferred one frame. `card-gallery.tsx` follows the same rule: `touchstart` touches nothing, the
gallery paints from the first drag move, and neighbour photos are preloaded as detached `Image()`
objects with the `<img>` mount pushed to the next frame.

**Verified in the sandbox**

```
real-page suite   18/18   scripts/_sandbox/gesture/real.mjs  (phone emulation + CDP touch)
  home       swipe on a photo turns the photo (rail stays, no navigation) ·
             the tap right after that swipe opens the PDP · swipe on the info area turns the rail
  /products  same on the grid · clean single tap opens the PDP ·
             vertical drag scrolls the page and leaves the photo alone
  PDP        related rail: photo swipe, rail paging (dots follow 0 → 1), single tap opens the PDP
  desktop    arrow click turns the photo (no navigation) · plain click opens the PDP ·
             mouse drag turns the photo (no navigation) · arrows stay inside
             `@media (hover: hover) and (pointer: fine)`
pure decision tests  22/22  scripts/_sandbox/gesture/pure-test.mjs  (railTarget 13 · galleryTarget 9)
tsc --noEmit       14 errors, all pre-existing Prisma-stand-in typing in unrelated admin/API files
                   (HEAD measured 16 on the same stand-in — this change adds none)
npm test           47/0 against the offline Prisma stand-in (the coupon / COD order / tracking
                   checks need rows to exist; a normal checkout runs them on the real sqlite DB)
```

The temporary `/touch-test` harness page used for the earlier probes is deleted; every check above
now runs against the real pages. Two sandbox-only helpers live in `scripts/_sandbox/` (git-ignored,
never shipped): `prisma-stub/install.sh` restores the offline Prisma stand-in that `npm ci` cannot
generate here, and `gesture/` holds the suites. What no sandbox can prove is the iPhone itself —
which is exactly why the fix for the reported symptom is a handler that was simply missing, and why
the machine keeps away from every WebKit-specific trick §12 listed.

## 18 · The gesture maths, out in the open — and one hover rule that was still stealing the first tap (2026-09-23)

§17 got the behaviour right. This pass made it *provable*, and the proof immediately found one more
real cause of "open korte 2 bar tap korte hoy".

**a) The audit found an unguarded `:hover` rule sitting on the photo.**

```
.pcard:hover .pcard-img .cg-img { transform: none; }      ← 402cc14, not inside any @media
```

On a touch screen the browser applies `:hover` to whatever the first tap lands on. When that
"hover" state changes the element the finger is on, iOS spends the first tap applying it and the
click that should have opened the product never happens — which is precisely the reported symptom,
on the product cards, in all three areas. It is wrapped in `@media (hover: hover)` now (the same
guard every other hover rule in `globals.css` already had, and the same thing the parallel `main`
branch's second pass did to this very line). Nothing changes visually: on a touch screen the zoom it
cancels lives inside a `@media (hover: hover)` block too, so there was never a transform to reset.

The check that caught it is now part of the test suite: *no unguarded `:hover` rule may change the
geometry of the thing under the finger* (`scripts/touch-audit.mjs`).

**b) The gesture maths moved into `components/gesture-math.ts` — pure, dependency-free.**

`lockAxis` · `isDrag` · `resist` · `slideAfter` · `railTarget` · `swallowPlan` · `shouldSwallow`,
with the thresholds (`AXIS_LOCK_PX 6`, `TAP_SLOP_PX 12`, `MOVE_RATIO 0.18`, `FLICK_VELOCITY 0.35`,
`RESIST 0.35`, `SWALLOW_MS 300`, `SWALLOW_RADIUS_PX 28`). The card gallery and the rails both import
from it (`galleryTarget` / `railTarget` stay exported as aliases), so the two surfaces can no longer
drift apart, and every rule can be asserted in node without a browser, an install or a database:
`components/use-swipe.ts` is left with the DOM half only.

**c) The acceptance test is committed, and runs with zero new dependencies.**

`npm run test:touch` → `scripts/touch-audit.mjs`: the three rules the owner tests by thumb, the
release/cancel maths, the CSS contract (touch-action, the hover guards, the tap-eating badge row) and
the wiring a pure function cannot see (no `setPointerCapture` anywhere, a real non-passive
`touchmove`, the swallow checked by **place and time** instead of a timer, no `useState` in the drag
machine, the rail skipping `.cg-swipeable`, the arrow press never starting a drag). It compiles the
maths with the repo's own TypeScript and runs it in a bare `vm` context, so an accidental import
into that file fails the audit instead of shipping.

**d) The browser half grew teeth.** The suites now install an event recorder inside the page
(`helpers.mjs` → `watch`), so an assertion is not just "the photo changed": a drag must receive **no
`pointercancel`**, and the tap that follows it must produce a click that is **not** swallowed. New
cases: pinch-zoom (started on a card) changes nothing and leaves the page scale at 1; a
`touchcancel` half-way through a drag settles on the photo the thumb was heading for; two drags back
to back advance two photos; a swipe followed by a tap **60 ms later** — and one with no gap at all —
still opens the product in a single tap.

One thing worth writing down for the next person: a tap that lands on the *edge* of a card while a
rail is still settling can have its click retargeted to the nearest common ancestor by the browser.
That is correct engine behaviour (the element under the finger changed between `touchstart` and
`touchend`), not a lost tap, and it is why the suites aim at the middle of a card, and why
`pull`/`pullInside` refuse to drag a finger off the screen.

**Verified (same sandbox, offline Prisma stand-in with a 12-product demo catalogue)**

```
npm run test:touch   47/0    scripts/touch-audit.mjs
real.mjs             21/0    home (photo + rail, tap-after-swipe) · /products (photo, clean tap,
                             tap-after-swipe, vertical scroll, pinch) · PDP related (photo, tap,
                             rail paging + live dots) · desktop (arrow, plain click, mouse drag,
                             hover/fine-pointer gate)
taptight.mjs          6/0    the back-to-back sequences above
npm test             47/0    the repo's own smoke suite (coupon, COD checkout, tracking, SEO, CSP…)
tsc --noEmit         14 errors, all pre-existing Prisma-stand-in typing in unrelated admin/API
                             files; measured 15 on the same stand-in at `origin/main` → adds none
```

`scripts/_sandbox/` (git-ignored, never shipped) now has `setup.sh` to rebuild the whole offline
environment — `npm ci --ignore-scripts`, the Prisma stand-in, puppeteer + the sandbox Chromium — and
`gesture/README.md` with the run recipes. The pure audit is the part that lives in the repo, so the
three rules stay guarded on every checkout.

Note for the merge: `origin/main` carries a *different* second pass at these same symptoms
(PR #3, `components/gallery-gesture.ts` + pointer events). This branch's engine is independent of it
and is the one the sandbox above exercises end to end; the only line both passes agreed on is the
hover guard in (a).

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
