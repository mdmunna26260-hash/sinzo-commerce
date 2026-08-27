"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, useWishlist, trackEvent, toast } from "@/components/store";

type V = { id: number; size: string | null; color: string | null; stock: number; price: number | null };
type P = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  shortDesc?: string | null; description?: string | null; sku?: string | null;
  stock: number; lowStock: number; images: { url: string; alt: string }[];
  variants: V[]; categoryName?: string;
};

export default function ProductPageClient({ product, sizeChartHtml }: { product: P; sizeChartHtml: string | null }) {
  const { add } = useCart();
  const router = useRouter();
  const wishlist = useWishlist();
  const [img, setImg] = useState(0);
  const [size, setSize] = useState<string | null>(product.variants.find((v) => v.size)?.size || null);
  const [color, setColor] = useState<string | null>(product.variants.find((v) => v.color)?.color || null);
  const [qty, setQty] = useState(1);
  const [zoom, setZoom] = useState(false);
  const [chart, setChart] = useState(false);
  const [buying, setBuying] = useState(false);

  const sizes = Array.from(new Set(product.variants.map((v) => v.size).filter(Boolean))) as string[];
  const colors = Array.from(new Set(product.variants.map((v) => v.color).filter(Boolean))) as string[];

  const activeVariant = product.variants.find((v) =>
    (!size || v.size === size) && (!color || v.color === color)) || null;
  const avail = activeVariant ? activeVariant.stock : product.variants.length ? 0 : product.stock;
  const price = activeVariant?.price || product.price;
  const off = product.comparePrice && product.comparePrice > price ? Math.round((1 - price / product.comparePrice) * 100) : 0;

  useEffect(() => {
    trackEvent("ViewContent", {
      value: price, currency: "BDT", content_name: product.title,
      content_ids: [String(product.id)], content_type: "product",
      contents: [{ id: String(product.id), quantity: 1, item_price: price }],
    }, { eventId: "vc_" + product.id + "_" + Date.now().toString(36) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const addLine = () => {
    add({
      productId: product.id, variantId: activeVariant?.id, slug: product.slug, title: product.title,
      image: product.images[0]?.url, price, qty, size: size || undefined, color: color || undefined,
      stock: avail || 99,
    }, qty);
    toast("Added to cart ✓");
  };
  const buyNow = () => {
    setBuying(true);
    add({ productId: product.id, variantId: activeVariant?.id, slug: product.slug, title: product.title, image: product.images[0]?.url, price, qty, size: size || undefined, color: color || undefined, stock: avail || 99 }, qty);
    router.push("/checkout");
  };

  return (
    <>
      <div className="pdp">
        <div className="pdp-gallery">
          {product.images.length > 1 && (
            <div className="thumbs">
              {product.images.map((im, i) => (
                <img key={i} src={im.url} alt={im.alt} className={i === img ? "active" : ""} onClick={() => setImg(i)} />
              ))}
            </div>
          )}
          <div className="pdp-main-img" style={product.images.length <= 1 ? { gridColumn: "1 / -1" } : undefined}>
            <img src={product.images[img]?.url || product.images[0]?.url} alt={product.images[img]?.alt || product.title} onClick={() => setZoom(!zoom)} style={{ transform: zoom ? "scale(1.6)" : undefined, transformOrigin: "center" }} className={avail <= 0 ? "soldout" : undefined} />
            {avail <= 0 && <div className="soldout-overlay"><span>Sold Out</span></div>}
          </div>
        </div>
        <div className="pdp-info">
          {product.categoryName && <div className="eyebrow">{product.categoryName}</div>}
          <h1>{product.title}</h1>
          <div className="pdp-price">
            <b>৳{price.toLocaleString("en-IN")}</b>
            {product.comparePrice && product.comparePrice > price && (<><s>৳{product.comparePrice.toLocaleString("en-IN")}</s><span className="off">{off}% OFF</span></>)}
          </div>
          {product.shortDesc && <p className="pdp-desc">{product.shortDesc}</p>}

          {sizes.length > 0 && (
            <>
              <div className="opt-label">Size {sizeChartHtml && <button className="sizechart-link" onClick={() => setChart(true)}>· Size chart</button>}</div>
              <div className="sizes">
                {sizes.map((s) => {
                  const v = product.variants.find((x) => x.size === s && (!color || x.color === color));
                  const stock = v?.stock || 0;
                  return (
                    <button key={s} className={"size-btn" + (size === s ? " active" : "")} disabled={stock <= 0}
                      onClick={() => { setSize(s); setQty(1); }}>{s}</button>
                  );
                })}
              </div>
            </>
          )}
          {colors.length > 0 && (
            <>
              <div className="opt-label">Color {color && <span style={{ textTransform: "none", letterSpacing: 0 }}>— {color}</span>}</div>
              <div className="sizes">
                {colors.map((c) => (
                  <button key={c} title={c} aria-label={c} className={"color-dot" + (color === c ? " active" : "")}
                    style={{ background: c.toLowerCase() === "white" || c.toLowerCase() === "off-white" || c.toLowerCase() === "cream" ? "#f4f0e8" : c.toLowerCase() }}
                    onClick={() => { setColor(c); setQty(1); }} />
                ))}
              </div>
            </>
          )}

          <div className="opt-label">Quantity</div>
          <div className="qty">
            <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty(Math.min(qty + 1, avail || 1))} aria-label="Increase">+</button>
          </div>
          <div style={{ marginTop: 10 }}>
            {avail > 0 ? (
              <span className="stock-note">{avail <= 5 ? `Only ${avail} left — order soon` : "In stock"}</span>
            ) : <span className="stock-note low">Sold out</span>}
          </div>

          <div className="pdp-actions">
            <button className="btn" disabled={avail <= 0} onClick={addLine}>Add to Cart</button>
            <button className="btn btn-accent" disabled={avail <= 0 || buying} onClick={buyNow}>{buying ? "One moment…" : "Buy Now"}</button>
            <button className="btn btn-outline" style={{ flex: "0 0 auto", minWidth: 0, padding: "13px 16px" }} onClick={() => wishlist.toggle(product.id)} aria-label="Wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill={wishlist.has(product.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
            </button>
          </div>

          <div className="pdp-meta">
            <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>Cash on Delivery available all over Bangladesh</div>
            <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Inside Dhaka 1–2 days · Outside Dhaka 2–4 days</div>
            <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.6 4.2M3 3v5h5"/></svg>7-day easy return &amp; exchange</div>
            {product.sku && <div style={{ fontSize: 12 }}>SKU: {product.sku}</div>}
          </div>
        </div>
      </div>

      {product.description && (
        <section className="section" style={{ padding: "10px 0 46px" }}>
          <div className="section-head"><div><div className="eyebrow">The details</div><h2>About this product</h2></div></div>
          <p style={{ maxWidth: 720, color: "var(--muted)", fontSize: 15.5 }}>{product.description}</p>
        </section>
      )}

      {/* sticky mobile add-to-cart */}
      <div className="sticky-atc">
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>৳{price.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: avail > 0 ? "var(--ok)" : "var(--danger)" }}>{avail > 0 ? "In stock" : "Sold out"}</div>
        </div>
        <button className="btn" disabled={avail <= 0} onClick={addLine}>Add to Cart</button>
      </div>

      {chart && sizeChartHtml && (
        <div className="modal-bg" onClick={() => setChart(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setChart(false)} aria-label="Close">×</button>
            <h3>Size Chart</h3>
            <div dangerouslySetInnerHTML={{ __html: sizeChartHtml.replace(/<table/, '<table class="sizechart-table"') }} />
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14 }}>Measurements are approximate. Between sizes? We recommend sizing up.</p>
          </div>
        </div>
      )}
    </>
  );
}
