"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart, toast } from "@/components/store";

/* Cart: quantity +/-, remove, size change — all live (no refresh needed). */
export default function CartPage() {
  const { lines, subtotal, setQty, updateLine, remove, ready } = useCart();
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const FREE_T = 5000;
  const ship = subtotal >= FREE_T ? 0 : 80;
  const discount = applied ? applied.discount : 0;
  const total = Math.max(0, subtotal - discount) + (applied?.freeship ? 0 : ship);

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/coupon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: coupon.trim(), subtotal }) });
      const j = await r.json();
      if (r.ok && j.valid) { setApplied(j); toast(`Coupon ${j.code} applied ✓`); }
      else { setApplied(null); toast(j.error || "Invalid coupon"); }
    } catch { toast("Network error"); }
    setBusy(false);
  };

  // old carts may lack sizes[] — fetch available sizes once per line
  useEffect(() => {
    if (!ready) return;
    for (const l of lines) {
      if (l.sizes && l.sizes.length) continue;
      fetch(`/api/cart/variant?productId=${l.productId}`)
        .then((r) => r.json())
        .then((j) => {
          if (j?.options?.length) updateLine(l.key, { sizes: j.options });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lines.length]);

  // old carts may lack sizes[] — fetch available sizes once per line
  useEffect(() => {
    if (!ready) return;
    for (const l of lines) {
      if (l.sizes && l.sizes.length) continue;
      fetch(`/api/cart/variant?productId=${l.productId}`)
        .then((r) => r.json())
        .then((j) => {
          if (j?.options?.length) updateLine(l.key, { sizes: j.options });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lines.length]);

  const changeSize = async (key: string, productId: number, newSize: string, color?: string) => {
    try {
      const r = await fetch(`/api/cart/variant?productId=${productId}&size=${encodeURIComponent(newSize)}${color ? "&color=" + encodeURIComponent(color) : ""}`);
      const j = await r.json();
      if (r.ok && j.match) {
        updateLine(key, { variantId: j.match.id, price: j.match.price ?? undefined, size: newSize, stock: j.match.stock });
        toast(`Size → ${newSize} ✓`);
      } else {
        toast(`Size ${newSize} is out of stock`);
      }
    } catch { toast("Network error"); }
  };

  if (!ready) {
    return <div className="container"><div className="empty" style={{ padding: "130px 20px" }}><h3>Loading…</h3></div></div>;
  }

  if (lines.length === 0) {
    return (
      <div className="container">
        <div className="empty" style={{ padding: "130px 20px" }}>
          <h3>Your cart is empty</h3>
          <p>Discover pieces made to last.</p>
          <br /><Link className="btn" href="/products">Start Shopping</Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, FREE_T - subtotal);

  return (
    <div className="container" style={{ padding: "38px 24px 100px" }}>
      <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", marginBottom: 30 }}>Your Cart</h1>
      <div className="cart-layout">
        <div>
          {lines.map((l) => (
            <div className="cart-row" key={l.key}>
              <Link href={"/products/" + l.slug}><img src={l.image} alt={l.title} loading="lazy" decoding="async" /></Link>
              <div>
                <div className="t"><Link href={"/products/" + l.slug}>{l.title}</Link></div>
                <div className="v">{[l.color].filter(Boolean).join(" · ")}</div>
                <div className="v">৳{Number(l.price || 0).toLocaleString("en-IN")}</div>
                {/* size switcher */}
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Size</span>
                  <select
                    className="cart-size-select"
                    value={l.size || ""}
                    onChange={(e) => changeSize(l.key, l.productId, e.target.value, l.color)}
                    aria-label="Change size"
                  >
                    {!l.size && <option value="">—</option>}
                    {l.sizes?.filter((s) => s !== l.size).map((s) => <option key={s} value={s}>{s}</option>)}
                    {l.size && <option value={l.size}>{l.size} ✓</option>}
                  </select>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="qty">
                    <button type="button" onClick={() => setQty(l.key, (l.qty || 1) - 1)} aria-label="Decrease quantity">−</button>
                    <span>{l.qty}</span>
                    <button type="button" onClick={() => setQty(l.key, (l.qty || 1) + 1)} aria-label="Increase quantity">+</button>
                  </div>
                  {l.stock && l.stock <= 5 && <span style={{ fontSize: 11, color: "var(--danger)" }}>only {l.stock} left</span>}
                </div>
                <button type="button" className="rm" onClick={() => { remove(l.key); toast("Removed from cart"); }}>Remove</button>
              </div>
              <div style={{ fontWeight: 600 }}>৳{(Number(l.price || 0) * (l.qty || 1)).toLocaleString("en-IN")}</div>
            </div>
          ))}
        </div>
        <aside className="summary">
          <h3>Order Summary</h3>
          <div className="freeship-note">
            {remaining > 0 ? <>Add <b>৳{remaining.toLocaleString("en-IN")}</b> more for free delivery</> : <>🎉 You&apos;ve unlocked <b>free delivery</b></>}
          </div>
          <div className="freebar"><i style={{ width: Math.min(100, (subtotal / FREE_T) * 100) + "%" }} /></div>
          <div className="sum-row"><span>Subtotal ({lines.reduce((s, l) => s + l.qty, 0)} items)</span><span>৳{subtotal.toLocaleString("en-IN")}</span></div>
          {discount > 0 && <div className="sum-row" style={{ color: "var(--ok)" }}><span>Discount ({applied.code})</span><span>−৳{discount.toLocaleString("en-IN")}</span></div>}
          <div className="sum-row"><span>Delivery (est.)</span><span>{(applied?.freeship || ship === 0) ? "Free" : "৳" + ship}</span></div>
          <div className="sum-row total"><span>Total</span><span>৳{total.toLocaleString("en-IN")}</span></div>
          <div className="coupon-row">
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
            <button className="abtn" onClick={applyCoupon} disabled={busy}>Apply</button>
          </div>
          <Link className="btn" style={{ width: "100%" }} href="/checkout">Proceed to Checkout</Link>
          <div className="trust">
            <span>🔒 Secure checkout</span><span>💵 Cash on Delivery</span><span>↩ 7-day returns</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
