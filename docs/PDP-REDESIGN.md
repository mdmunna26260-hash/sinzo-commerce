# Editorial product-page redesign

## Approved scope

Apply the supplied mobile/desktop visual reference, keeping the existing checkout and advertising tracking. This is a production integration, not a standalone HTML demo.

- Route-scoped CSS: warm neutral light palette, charcoal dark palette, editorial serif headings, compact size controls, rounded purchase buttons and three shopping-benefit tiles.
- Borderless main image stage, mobile edge-to-edge width, image count, expand control, segmented progress and four-across horizontally scrollable thumbnails. Desktop keeps a sticky gallery with previous/next controls. Both main image stages now use the owner's requested fixed 4:5 ratio on mobile and desktop. This PDP-only override supersedes the earlier admin-linked ratio; the saved global Product image ratio and other pages are unchanged. Images use `object-fit: contain` to preserve the entire product; sources with a different ratio can still have breathing room inside the stage. Follow-up: all eight bundled preview product originals and their nine responsive variants each (80 files) are now cropped to 4:5, preserving the top of fashion portraits. Originals are backed up locally in ignored `backup/pdp-product-images-before-4x5/`. Hero/banner assets and production database media are untouched.
- Product title, SKU, price, discounts, stock, variants, linked colours, promotions, sold-count settings and waitlist remain driven by existing data. No sample fabric claims, invented stock scarcity or hard-coded prices.
- Description starts expanded using native `details open`; the minus control collapses it and the plus control reopens it. Return/delivery policies start collapsed. Gallery text badges are removed on mobile and desktop. Excess vertical padding around the gallery, title, purchase controls, reviews and recommendation/history sections is reduced; readable gutters and touch-target sizes are preserved. The owner's delivery-time return inspection, two-day exchange and four-hour Dhaka Pathao/WhatsApp copy remain intact. The sample's seven-day exchange/free-return claims were not copied.
- Size guide is styled as a mobile bottom sheet. Both size guide and gallery lightbox have dialog semantics, keyboard focus containment/restoration, Escape dismissal and body-scroll locking.
- A quick-buy bar appears after scrolling past the purchase controls, including direct scroll jumps. It uses the same existing `buyNow` handler and selected price/size. Stock/preorder and busy-state restrictions remain in place.
- Shared site header/navigation and cart drawer remain real existing components. The reference's viewport inspector, fake checkout drawer, fake order confirmation, SVG garment placeholders, CDN Tailwind, extra Google fonts and disabled browser zoom are not imported.

## Checkout and tracking contract

The existing `line`, `addLine`, `buyNow` and ViewContent effect are unchanged; `tests/fixtures/pdp-purchase-contract.json` records the pre-redesign code and is compared against the TSX AST. The sticky button reuses `buyNow` rather than implementing another checkout. No changes to checkout pages/endpoints, store/cart/tracking implementation or package manifests/lockfile.

## Validation

- TypeScript, 265 unit tests and touch source audit (55 passed / 0 failed).
- Final ratio regression: Chromium at 390/1280px verified both main galleries render at 4:5 with matching cropped images and no page overflow. All eight product sources served at 800x1000, and the image regression test checks every bundled product original/variant. The saved global admin ratio was not modified. Earlier admin-linked ratio checks were superseded by the requested PDP-only 4:5 override.
- Optimized Next build using the sandbox PostgreSQL adapter preload and `.next-prod`. Standard production Neon/native-Prisma build was not run in this restricted sandbox.
- Local Chromium at 320, 390, 760, 900 and 1280px: borderless stage, exact mobile viewport width, no page overflow, thumbnail selection, real mobile swipe, image counters, lightbox, size guide, dark contrast, accordions and sticky-bar visibility.
- Dialog keyboard/body-scroll/focus-restoration checks, real cart quantity/variant persistence, ViewContent/AddToCart requests and existing `/checkout` navigation. Test tracking requests were intercepted locally; external Meta/Google delivery and a real order submission were not performed.
- Separate no-image / sold-out / preorder browser fixtures checked at 390/1280px; placeholder dimensions and purchase guards passed. Temporary products, photos and chart changes were restored/removed.

Local browser/database checks are not physical-device or production-provider verification. No deployment is included. Existing site-wide legacy return-policy discrepancies remain outside this visual change.
