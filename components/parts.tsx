import Link from "next/link";

export type CardProduct = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  image?: string; categoryName?: string; stock: number; isNew?: boolean; isBestSeller?: boolean;
};

export function ProductCard({ p, wish }: { p: CardProduct; wish?: boolean }) {
  const off = p.comparePrice && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
  return (
    <Link className="pcard reveal" href={"/products/" + p.slug}>
      <div className="pcard-img">
        {p.image && <img src={p.image} alt={p.title} loading="lazy" decoding="async" className={p.stock <= 0 ? "soldout" : undefined} />}
        <div className="pcard-badges">
          {off > 0 && <span className="badge sale">-{off}%</span>}
          {p.isBestSeller && <span className="badge best">★ Best Seller</span>}
          {p.isNew && <span className="badge new">New</span>}
        </div>
        {p.stock <= 0 && <div className="soldout-overlay"><span>Sold Out</span></div>}
        {wish ? <div className="pcard-quick"><button type="button">In your wishlist</button></div> : null}
      </div>
      <div className="pcard-info">
        <div className="pcard-title">{p.title}</div>
        {p.categoryName && <div className="pcard-cat">{p.categoryName}</div>}
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
