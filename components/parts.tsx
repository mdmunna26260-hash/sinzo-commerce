import type { CSSProperties } from "react";
import Link from "next/link";
import CardImg from "./card-img";
import CardGallery from "./card-gallery";
import QuickAdd from "./quick-add";
import { sortSizes } from "@/lib/sizes";

export { imgSrc, imgSrcSet } from "./img-src";
export { sortSizes } from "@/lib/sizes";

export type CardProduct = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  image?: string; categoryName?: string; stock: number; isNew?: boolean; isBestSeller?: boolean;
  colors?: string[]; sizes?: string[]; badge?: string | null; saleEnds?: string | null; preorder?: boolean;
  /* every photo of the product (ordered) — powers the drag-to-swipe card gallery.
     Optional: when absent/1 image the card falls back to the plain CardImg. */
  images?: string[];
  /* default (first in-stock) variant, so the one-tap path needs no roundtrip */
  qa?: { variantId: number; price: number; stock: number; size?: string | null; color?: string | null } | null; };

const BADGE_LABELS: Record<string, string> = {
  trending: "TRENDING NOW",
  hot: "HOT PICK",
  new: "NEW",
  signature: "SIGNATURE",
  limited: "LIMITED",
};

export function ProductCard({ p, rd }: { p: CardProduct; rd?: number }) {
  const off = p.comparePrice && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
  /* The cell is the positioning parent and carries the stagger delay, so the quick-add button
     fades in with its card instead of floating over an invisible one. The <Link> stays the
     anchor of everything it already was — the button is a sibling, not a child, because an
     <a> may not contain interactive content. */
  return (
    <div className="pcard-cell" style={rd != null ? ({ "--rd": rd } as CSSProperties) : undefined}>
    <Link className="pcard reveal" href={"/products/" + p.slug}>
      <div className="pcard-img">
        {(() => {
          const gallery = (p.images || []).filter(Boolean);
          if (gallery.length > 1) return <CardGallery images={gallery} alt={p.title} />;
          return p.image ? <CardImg url={p.image} alt={p.title} slug={p.slug} /> : null;
        })()}
        <div className="pcard-badges">
          {p.stock <= 0 && !p.preorder && <span className="badge">SOLD OUT</span>}
          {p.preorder && <span className="badge">Pre-Order</span>}
          {off > 0 && <span className="badge">-{off}%</span>}
          {p.badge && <span className="badge">{BADGE_LABELS[p.badge] || p.badge}</span>}
          {p.saleEnds && new Date(p.saleEnds).getTime() > Date.now() && off > 0 && (
            <span className="badge">FLASH</span>
          )}
        </div>
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
      <QuickAdd p={p} />
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{"★".repeat(Math.max(0, Math.min(5, n)))}{"☆".repeat(5 - Math.max(0, Math.min(5, n)))}</span>;
}
