# updated 2026-09-14

## ccf3eb6 — Unified reference-style card badges + pre-order SOLD OUT fixes (LIVE)
- ALL product-card badges = one unified light chip, top-left (ref: vescartes
  look): SOLD OUT, Pre-Order, -X% discount, NEW/LIMITED/TRENDING etc, FLASH.
  Same style PC + mobile (mobile override that stripped badge bg removed).
  Sold Out is now a chip — NOT a full image overlay on cards (PDP overlay
  unchanged).
- /products infinite grid dropped `preorder` in card mapping → FADE BLACK
  showed SOLD OUT on the products page. Fixed. Wishlist select+mapping now
  preorder-aware too.
- Verified locally: Pre-Order chip ✓, -23% chip ✓, SOLD OUT chip ✓
  (temp 0-stock test, stock restored exactly).
- Deploy: origin+next=`ccf3eb6`; Vercel prod/staging manual v13 API.

## 0c77829 — Steadfast inventory flow + PDP/card cleanups + category image fix (LIVE on all 3 sites)
- **Inventory = Steadfast-delivered-based:** stock decrements ONLY when order is DELIVERED
  (Steadfast status sync `courier GET` or manual admin DELIVERED) — exact variant(size)+product
  qty in one DB transaction. NOT at checkout (sold-out validation kept). No restock on plain
  cancel/return — restock only when stock was actually deducted (delivered→returned, or legacy
  orders detected via their "ORDER" inventory movement → no backfill needed).
  Idempotency + race-safety: `Order.stockDeducted` flag set by ATOMIC CLAIM
  (`UPDATE … WHERE stockDeducted=false`) inside the transaction — testing caught a real
  double-decrement race (fire-and-forget + check-before-tx) and it was fixed.
  New file `lib/deliver-stock.ts`; column via schema + db-ensure + pre-added to prod Neon DB.
- **"You may also like":** pre-order products → PRE-ORDER badge, NO Sold Out overlay
  (relSelect + both card mappings + preorder-aware sizes in PDP page.tsx).
- **Category name removed** from PDP (eyebrow) and all product cards (pcard-cat).
- **Announcement bar always day theme:** `.announce{background:#141414;color:#faf9f7}` —
  dark mode no longer inverts it.
- **Category image upload fixed:** PUT is now PARTIAL (image-only no longer wipes
  description/sizeChart; empty PUT → 400), client surfaces real errors (was silent),
  admin catalog shows the saved image thumbnail (mapping had no `image` field).
- **Live viewers OFF** (PDP `<LiveWatching/>` unmounted; component dormant in
  components/live-watching.tsx — re-enable by re-adding the render + import).
- Verified: full inventory test cycle vs live DB (checkout no-decrement ✓, delivery exact
  decrement + DELIVERED movement ✓, idempotent ✓, cancel no-restock ✓, pre-order 0-stock
  never negative ✓, legacy skip ✓) — all test data cleaned, stock restored exactly.
- Deploy: local=origin=next=`0c77829`; VPS auto (Dokploy) + Vercel prod/staging manual
  v13 API (dpl_5vgVQ4Y7rhHWZT7V1aKGdW2ZRSTi, dpl_EtuKKLc4XdkWZ9euPKAnRgL223y5).
  All 3 sites verified: same CSS `b68de754dfcd86fb`, PDP checks pass.

## 2f713a6 SECURITY FIXES (2026-09-13 audit): invoice PII gate (phone required) · checkout accepts +880 phone format · WhatsApp BD JID fix (88016...) · order+stock+coupon in DB transaction (no oversell) · rate limits on public APIs · HSTS header · Product JSON-LD (SEO) · category slug update support · no hardcoded admin passwords in seed/smoke
