import Link from "next/link";
import WishHeart from "./wish-heart";

const BADGE_LABELS: Record<string, string> = {
  trending: "TRENDING NOW",
  hot: "HOT PICK",
  new: "NEW",
  signature: "SIGNATURE",
  limited: "LIMITED",
};

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

export type CardProduct = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  image?: string; categoryName?: string; stock: number; isNew?: boolean; isBestSeller?: boolean;
  colors?: string[]; sizes?: string[]; badge?: string | null; };

export function ProductCard({ p, wish }: { p: CardProduct; wish?: boolean }) {
  const off = p.comparePrice && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
  return (
    <Link className="pcard reveal" href={"/products/" + p.slug}>
      <div className="pcard-img">
        {p.image && (() => {
          return <img src={imgSrc(p.image, 600)} srcSet={imgSrcSet(p.image, [300, 600, 1000, 1200])} sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 300px" alt={p.title} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
        })()}
        <div className="pcard-badges">
          {off > 0 && <span className="badge sale">-{off}%</span>}
          {p.badge && <span className={"badge badge-" + p.badge}>{BADGE_LABELS[p.badge] || p.badge}</span>}
        </div>
        <WishHeart id={p.id} />
        {p.stock <= 0 && <div className="soldout-overlay"><span>Sold Out</span></div>}
        {wish ? <div className="pcard-quick"><button type="button">In your wishlist</button></div> : null}
      </div>
      <div className="pcard-info">
        <div className="pcard-title">{p.title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span className="pcard-cat">{p.categoryName}</span>
          {p.colors && p.colors.length > 0 && (
            <span className="pcard-colors" title={p.colors.join(", ")}>
              {p.colors.slice(0, 4).map((c, i) => (
                <i key={i} style={{ background: ["white", "off-white", "cream"].includes(c.toLowerCase()) ? "#f4f0e8" : c.toLowerCase() }} />
              ))}
            </span>
          )}
        </div>
        {p.sizes && p.sizes.length > 0 && (
          <div className="pcard-sizes">Size: {p.sizes.join(", ")}</div>
        )}
        <div className="price">
          <b>৳{p.price.toLocaleString("en-IN")}</b>
          {p.comparePrice && p.comparePrice > p.price && (<><s>৳{p.comparePrice.toLocaleString("en-IN")}</s><span className="off">Save ৳{(p.comparePrice - p.price).toLocaleString("en-IN")}</span></>)}
        </div>
      </div>
    </Link>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{"★".repeat(Math.max(0, Math.min(5, n)))}{"☆".repeat(5 - Math.max(0, Math.min(5, n)))}</span>;
}
