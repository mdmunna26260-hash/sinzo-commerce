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
