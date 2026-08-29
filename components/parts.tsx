import Link from "next/link";
import WishHeart from "./wish-heart";
import CardImg from "./card-img";

export { imgSrc, imgSrcSet } from "./img-src";

const BADGE_LABELS: Record<string, string> = {
  trending: "TRENDING NOW",
  hot: "HOT PICK",
  new: "NEW",
  signature: "SIGNATURE",
  limited: "LIMITED",
};

export type CardProduct = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  image?: string; categoryName?: string; stock: number; isNew?: boolean; isBestSeller?: boolean;
  colors?: string[]; sizes?: string[]; badge?: string | null; };

export function ProductCard({ p, wish }: { p: CardProduct; wish?: boolean }) {
  const off = p.comparePrice && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
  return (
    <Link className="pcard reveal" href={"/products/" + p.slug}>
      <div className="pcard-img">
        {p.image && <CardImg url={p.image} alt={p.title} />}
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
