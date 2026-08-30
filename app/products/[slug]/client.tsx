"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, useWishlist, trackEvent, toast } from "@/components/store";
import { imgSrc, imgSrcSet } from "@/components/parts";
import { warmImage } from "@/components/img-warm";

type V = { id: number; size: string | null; color: string | null; stock: number; price: number | null };
type P = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  shortDesc?: string | null; description?: string | null; sku?: string | null;
  stock: number; lowStock: number; images: { url: string; alt: string }[];
  variants: V[]; categoryName?: string;
};

export default function ProductPageClient({ product, sizeChartHtml, sizeChartImage }: { product: P; sizeChartHtml: string | null; sizeChartImage: string | null }) {
  const { add } = useCart();
  const router = useRouter();
  const wishlist = useWishlist();
  const N = product.images.length;

  // ---------- gallery state ----------
  const [img, setImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [lbIdx, setLbIdx] = useState(0);
  const [lbZoom, setLbZoom] = useState(false);
  const [hoverZoom, setHoverZoom] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  /* Instant swap, no fade-gate: the <img> element keeps displaying the previous
     bitmap while the new src downloads (browser-native behaviour), so tapping a
     thumbnail NEVER shows a blank box — the new photo appears the moment it's
     decoded. warmImage() races the exact variant into cache ahead of the swap. */
  const goTo = (i: number) => {
    const n = ((i % N) + N) % N;
    if (n === img) return;
    warmImage(product.images[n]?.url);
    setImg(n);
  };
  const next = () => goTo(img + 1);
  const prev = () => goTo(img - 1);

  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent, isLb = false) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      if (isLb) setLbIdx(((lbIdx + (dx < 0 ? 1 : -1)) % N + N) % N); else (dx < 0 ? next : prev)();
    }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!lightbox) return;
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") setLbIdx(((lbIdx + 1) % N + N) % N);
      if (e.key === "ArrowLeft") setLbIdx(((lbIdx - 1) % N + N) % N);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [lightbox, lbIdx, N]);

  // ---------- variant / buy state (existing logic) ----------
  const [size, setSize] = useState<string | null>(product.variants.find((v) => v.size)?.size || null);
  const [color, setColor] = useState<string | null>(product.variants.find((v) => v.color)?.color || null);
  const [qty, setQty] = useState(1);
  const [chart, setChart] = useState(false);
  const [buying, setBuying] = useState(false);

  const sizes = Array.from(new Set(product.variants.map((v) => v.size).filter(Boolean))) as string[];
  const colors = Array.from(new Set(product.variants.map((v) => v.color).filter(Boolean))) as string[];

  const activeVariant = product.variants.find((v) => (!size || v.size === size) && (!color || v.color === color)) || null;
  const avail = activeVariant ? activeVariant.stock : product.variants.length ? 0 : product.stock;
  const price = activeVariant?.price || product.price;
  const off = product.comparePrice && product.comparePrice > price ? Math.round((1 - price / product.comparePrice) * 100) : 0;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Idle-warm the rest of the gallery ~1.5s after load → swiping photos is instant
  useEffect(() => {
    const t = setTimeout(() => { for (const im of product.images) warmImage(im.url, { idle: true }); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  useEffect(() => {
    trackEvent("ViewContent", {
      value: price, currency: "BDT", content_name: product.title,
      content_ids: [String(product.id)], content_type: "product",
      contents: [{ id: String(product.id), quantity: 1, item_price: price }],
    }, { eventId: "vc_" + product.id + "_" + Date.now().toString(36) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const line = () => ({
    productId: product.id, variantId: activeVariant?.id, slug: product.slug, title: product.title,
    image: product.images[0]?.url, price, qty, size: size || undefined, color: color || undefined, stock: avail || 99,
  });
  const addLine = () => { add(line(), qty); toast("Added to cart ✓"); };
  const buyNow = () => { setBuying(true); add(line(), qty); router.push("/checkout"); };

  return (
    <>
      <div className="pdp">
        {/* ---------------- GALLERY ---------------- */}
        <div className="pdp-gallery">
          <div
            className={"pdp-main-img" + (N <= 1 ? " single" : "")}
            onTouchStart={onTouchStart}
            onTouchEnd={(e) => onTouchEnd(e)}
          >
            <img
              src={imgSrc((product.images[img] || product.images[0])?.url, 1000) || (product.images[img] || product.images[0])?.url}
              srcSet={imgSrcSet((product.images[img] || product.images[0])?.url, [600, 1000, 1200])}
              sizes="(max-width: 900px) 100vw, 45vw"
              alt={product.images[img]?.alt || product.title}
              className={"pdp-img" + (hoverZoom && avail > 0 ? " hz" : "")}
              fetchPriority="high"
              style={hoverZoom ? { transformOrigin: "50% 50%" } : undefined}
              onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) setHoverZoom(true); }}
              onMouseLeave={() => { setHoverZoom(false); }}
              onMouseMove={(e) => {
                // write transform-origin straight to the DOM node — no re-render on every mousemove
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
              }}
            />
            {/* zoom — top right corner */}
            <button className="gal-zoom" title="Zoom" aria-label="Zoom image"
              onClick={() => { setLbIdx(img); setLbZoom(false); setLightbox(true); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
            </button>
            {N > 1 && (
              <>
                <button className="gal-nav prev" aria-label="Previous image" onClick={prev}>‹</button>
                <button className="gal-nav next" aria-label="Next image" onClick={next}>›</button>
                <div className="gal-count">{img + 1} / {N}</div>
              </>
            )}
            {avail <= 0 && <div className="soldout-overlay"><span>Sold Out</span></div>}
          </div>

          {N > 1 && (
            <div className="thumbs">
              {product.images.map((im, i) => (
                <button key={i} className={i === img ? "active" : ""} onClick={() => goTo(i)} aria-label={"Image " + (i + 1)}>
                  <img src={imgSrc(im.url, 300) || im.url} alt={im.alt} loading="lazy" decoding="async" width={72} height={96} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---------------- INFO ---------------- */}
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
              <div className="opt-label">Size {(sizeChartHtml || sizeChartImage) && <button className="sizechart-link" onClick={() => setChart(true)}>· Size chart</button>}</div>
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
          <FormattedDescription text={product.description} />
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

      {/* size chart modal */}
      {chart && (sizeChartImage || sizeChartHtml) && (
        <div className="modal-bg" onClick={() => setChart(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setChart(false)} aria-label="Close">×</button>
            <h3>Size Chart</h3>
            {sizeChartImage && <img src={sizeChartImage} alt="Size chart" style={{ width: "100%", borderRadius: 4 }} />}
            {!sizeChartImage && sizeChartHtml && <div dangerouslySetInnerHTML={{ __html: sizeChartHtml.replace(/<table/, '<table class="sizechart-table"') }} />}
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14 }}>Measurements are approximate. Between sizes? We recommend sizing up.</p>
          </div>
        </div>
      )}

      {/* ---------- LIGHTBOX (zoom) ---------- */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <div className="lb-top" onClick={(e) => e.stopPropagation()}>
            <button title={lbZoom ? "Zoom out" : "Zoom in"} onClick={() => setLbZoom(!lbZoom)} aria-label="Toggle zoom">
              {lbZoom ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
              )}
            </button>
            <button title="Close" onClick={() => setLightbox(false)} aria-label="Close">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="lb-count">{lbIdx + 1} / {N}</div>
          <img
            src={product.images[lbIdx]?.url || product.images[0]?.url}
            alt={product.images[lbIdx]?.alt || product.title}
            className={lbZoom ? "zoomed" : ""}
            style={lbZoom ? { transformOrigin: "50% 50%" } : undefined}
            onClick={(e) => { e.stopPropagation(); setLbZoom(!lbZoom); }}
            onMouseMove={(e) => { if (lbZoom) { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; } }}
            onTouchStart={onTouchStart}
            onTouchEnd={(e) => { e.stopPropagation(); onTouchEnd(e, true); }}
          />
          {N > 1 && (
            <>
              <button className="lb-nav prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setLbZoom(false); setLbIdx(((lbIdx - 1) % N + N) % N); }}>‹</button>
              <button className="lb-nav next" aria-label="Next" onClick={(e) => { e.stopPropagation(); setLbZoom(false); setLbIdx((lbIdx + 1) % N); }}>›</button>
            </>
          )}
        </div>
      )}
    </>
  );
}


/* Lightweight markdown-ish renderer for admin-formatted descriptions:
   ## heading · **bold** · _italic_ · ~~small~~ · • / ✓ list items */
function FormattedDescription({ text }: { text: string }) {
  const inline = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)_(.+?)_(?=\s|$|[,.;:!?)])/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, '<span style="font-size:.85em;color:var(--muted)">$1</span>');
  const blocks: React.ReactNode[] = [];
  let list: { icon: string; text: string }[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={"l" + blocks.length} style={{ margin: "8px 0", paddingLeft: 6, listStyle: "none", display: "grid", gap: 6 }}>
          {list.map((li, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "var(--text)", fontSize: 15 }}>
              <span style={{ color: "var(--accent)", fontWeight: 700, flex: "none" }}>{li.icon}</span>
              <span dangerouslySetInnerHTML={{ __html: inline(li.text) }} />
            </li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) { flush(); blocks.push(<h3 key={i} style={{ fontSize: 20, margin: "22px 0 6px", fontFamily: "var(--font-head)" }}>{line.replace(/^##\s+/, "")}</h3>); }
    else if (/^[•✓]\s+/.test(line)) { list.push({ icon: line[0], text: line.replace(/^[•✓]\s+/, "") }); }
    else if (line.trim() === "") { flush(); }
    else { flush(); blocks.push(<p key={i} style={{ marginBottom: 10, color: "var(--muted)", fontSize: 15.5, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: inline(line) }} />); }
  });
  flush();
  return <div style={{ maxWidth: 720 }}>{blocks}</div>;
}
