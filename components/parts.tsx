import type { CSSProperties } from "react";
import Link from "next/link";
import WishHeart from "./wish-heart";
import CardImg from "./card-img";

export { imgSrc, imgSrcSet } from "./img-src";

export type CardProduct = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  image?: string; categoryName?: string; stock: number; isNew?: boolean; isBestSeller?: boolean;
  colors?: string[]; sizes?: string[]; badge?: string | null; saleEnds?: string | null; preorder?: boolean; };

const BADGE_LABELS: Record<string, string> = {
  trending: "TRENDING NOW",
  hot: "HOT PICK",
  new: "NEW",
  signature: "SIGNATURE",
  limited: "LIMITED",
};

/* serial order: numeric ascending first (28, 30, 32…), then S → M → L → XL → XXL → … */
const SIZE_SEQ = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL"];
function sizeRank(s: string): number {
  const u = s.trim().toUpperCase().replace(/^3XL$/, "XXXL");
  const i = SIZE_SEQ.indexOf(u);
  return i === -1 ? 999 : i;
}
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    if (!Number.isNaN(na)) return -1;
    if (!Number.isNaN(nb)) return 1;
    const ra = sizeRank(a), rb = sizeRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

export function ProductCard({ p, wish, rd }: { p: CardProduct; wish?: boolean; rd?: number }) {
  const off = p.comparePrice && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
  return (
    <Link className="pcard reveal" href={"/products/" + p.slug} style={rd != null ? ({ "--rd": rd } as CSSProperties) : undefined}>
      <div className="pcard-img">
        {p.image && <CardImg url={p.image} alt={p.title} slug={p.slug} />}
        <div className="pcard-badges">
          {p.stock <= 0 && !p.preorder && <span className="badge">SOLD OUT</span>}
          {p.preorder && <span className="badge">Pre-Order</span>}
          {off > 0 && <span className="badge">-{off}%</span>}
          {p.badge && <span className="badge">{BADGE_LABELS[p.badge] || p.badge}</span>}
          {p.saleEnds && new Date(p.saleEnds).getTime() > Date.now() && off > 0 && (
            <span className="badge">FLASH</span>
          )}
        </div>
        <WishHeart id={p.id} />
        {wish ? <div className="pcard-quick"><button type="button">In your wishlist</button></div> : null}
      </div>
      <div className="pcard-info">
        <div className="pcard-title">{p.title}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {p.colors && p.colors.length > 0 && (
            <span className="pcard-colors" title={p.colors.join(", ")}>
              {p.colors.slice(0, 4).map((c, i) => (
                <i key={i} style={{ background: ["white", "off-white", "cream"].includes(c.toLowerCase()) ? "#f4f0e8" : c.toLowerCase() }} />
              ))}
            </span>
          )}
        </div>
        {p.sizes && p.sizes.length > 0 && (
          <div className="pcard-sizes">Size: {sortSizes(p.sizes).join(", ")}</div>
        )}
        <div className="price">
          <b>৳{p.price.toLocaleString("en-IN")}</b>
          {/* discount badge ("Save ৳X") removed per request — the struck compare price stays so the
              saving is still readable without a promo-y label on every card */}
          {p.comparePrice && p.comparePrice > p.price && <s>৳{p.comparePrice.toLocaleString("en-IN")}</s>}
        </div>
      </div>
    </Link>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{"★".repeat(Math.max(0, Math.min(5, n)))}{"☆".repeat(5 - Math.max(0, Math.min(5, n)))}</span>;
}
