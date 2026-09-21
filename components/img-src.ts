/* Shared image-variant helpers — used by every storefront surface.
   /uploads/seed/x.jpg   → /uploads/seed/x-{w}.webp   (pre-generated)
   /api/media/{id}       → /api/media/{id}/w{w}        (on-the-fly variant)
   Tolerates cache-buster query strings (?v=…) on both URL kinds. */
const MEDIA_RE = /^(\/api\/media\/([a-z0-9]+))(\?.*)?$/i;

export function imgSrc(url: string | undefined | null, w: number): string {
  if (!url) return "";
  const m = url.match(MEDIA_RE);
  if (m) return `/api/media/${m[2]}/w${w}${m[3] || ""}`;
  if (/\/uploads\/seed\/[^?]*\.jpg/i.test(url)) return url.replace(/\.jpg(\?.*)?$/i, `-${w}.webp$1`);
  return url;
}
export function imgSrcSet(url: string | undefined | null, ws: number[]): string | undefined {
  if (!url) return undefined;
  const m = url.match(MEDIA_RE);
  if (m) return ws.map((w) => `/api/media/${m[2]}/w${w} ${w}w`).join(", ");
  if (/\/uploads\/seed\/[^?]*\.jpg/i.test(url)) {
    // .jpg(?query)? → -{w}.webp(?query) — the buster rides along on every candidate
    return ws.map((w) => `${url.replace(/\.jpg(\?.*)?$/i, `-${w}.webp$1`)} ${w}w`).join(", ");
  }
  return undefined;
}

/* ---------------------------------------------------------------------------
   Placement rules — ONE place that decides how many pixels each surface shows.

   Without `sizes` a browser assumes the image spans the FULL viewport and picks
   the largest candidate: a 190px card was downloading a 1200px file (measured
   7-8x over-fetch on /products at 390px). Every <img> in the storefront now
   declares its rendered width and offers only the rungs it can actually use.

   The numbers mirror the real grid in globals.css:
     .shop-grid  2 cols (<900) · 3 cols (>=900) · 4 cols (>=1200) · 5 cols (>=1500)
     .pdp-gallery 72px thumbs + main column (1.1fr of the 1440px container)
   --------------------------------------------------------------------------- */
export const CONTAINER = "min(100vw, 1440px)";

/* product card / gallery slide inside a card */
export const CARD_WIDTHS = [200, 300, 400, 600, 800];
export const CARD_SIZES =
  `(max-width: 899px) calc(50vw - 22px), ` +
  `(max-width: 1199px) calc((${CONTAINER} - 320px) / 3), ` +
  `(max-width: 1499px) calc((${CONTAINER} - 340px) / 4), ` +
  `calc((${CONTAINER} - 350px) / 5)`;

/* product detail page hero (mobile full-bleed, desktop gallery column) */
/* Hero rungs stop at 1000 on purpose: it is 2.5x on a 390px phone and ~1.6x on a desktop
   gallery column, so the 1200 rung (69KB median, 389KB on noisy sources) only added weight.
   w1200 stays in the ladder for the social/og share image, which is fetched once by crawlers. */
export const PDP_WIDTHS = [400, 600, 800, 1000];
export const PDP_SIZES = `(max-width: 899px) 100vw, calc(52vw - 120px)`;

/* small square/portrait thumbs: PDP strip (72px), mobile strip (56px), cart rows (100px),
   checkout lines (52px), order rows (38px), colour swatches (44px) */
export const THUMB_WIDTHS = [200, 300];
