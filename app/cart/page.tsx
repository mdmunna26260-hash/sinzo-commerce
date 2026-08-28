"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart, toast } from "@/components/store";

/* Cart — original clean layout + "Continue Shopping" button on top. */
export default function CartPage() {
  const { lines, subtotal, setQty, updateLine, remove, ready } = useCart();
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const FREE_T = 5000;
  const ship = subtotal >= FREE_T ? 0 : 80;
  const discount = applied ? applied.discount : 0;
  const total = Math.max(0, subtotal - discount) + (applied?.freeship ? 0 : ship);
  const itemCount = lines.reduce((s, l) => s + (l.qty || 1), 0);

  const bump = (l: any, q: number) => {
    if (q < 1) { remove(l.key); toast("Item removed from cart"); return; }
    setQty(l.key, q);
    toast("Cart item updated successfully");
  };

  const changeSize = async (l: any, newSize: string) => {
    try {
      const r = await fetch(`/api/cart/variant?productId=${l.productId}&size=${encodeURIComponent(newSize)}${l.color ? "&color=" + encodeURIComponent(l.color) : ""}`);
      const j = await r.json();
      if (r.ok && j.match) {
        updateLine(l.key, { variantId: j.match.id, price: j.match.price ?? l.price, size: newSize, stock: j.match.stock });
        toast("Cart item updated successfully");
      } else toast(`Size ${newSize} is out of stock`);
    } catch { toast("Network error"); }
  };

  // lazy: old carts missing sizes[]
  useEffect(() => {
    if (!ready) return;
    for (const l of lines) {
      if (l.sizes && l.sizes.length) continue;
      fetch(`/api/cart/variant?productId=${l.productId}`)
        .then((r) => r.json())
        .then((j) => { if (j?.options?.length) updateLine(l.key, { sizes: j.options }); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lines.length]);

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

  if (!ready) {
    return <div className="container"><div className="empty" style={{ padding: "130px 20px" }}><h3>Loading…</h3></div></div>;
  }

  if (lines.length === 0) {
    return (
      <div className="container">
        <div className="cart-head">
          <div className="eyebrow">Shopping Cart</div>
          <h1>Your Cart</h1>
          <p className="cart-sub">0 items in your cart</p>
        </div>
        <div className="empty" style={{ padding: "60px 20px" }}>
          <h3>Your cart is empty</h3>
          <p>Discover pieces made to last.</p>
          <br /><Link className="btn" href="/products">Start Shopping</Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, FREE_T - subtotal);

  return (
    <div className="container" style={{ padding: "34px 24px 100px" }}>
      <div className="cart-head">
        <div className="eyebrow">Shopping Cart</div>
        <h1>Your Cart</h1>
        <p className="cart-sub">{itemCount} item{itemCount !== 1 ? "s" : ""} in your cart</p>
        <Link className="btn btn-outline cart-continue" href="/products">Continue Shopping</Link>
      </div>

      <div className="cart-layout">
        <div>
          {lines.map((l) => (
            <div className="cart-row" key={l.key}>
              <Link href={"/products/" + l.slug}><img src={l.image} alt={l.title} loading="lazy" decoding="async" /></Link>
              <div>
                <div className="t"><Link href={"/products/" + l.slug}>{l.title}</Link></div>
                <div className="v">{[l.color].filter(Boolean).join(" · ")}</div>
                <div className="v">৳{Number(l.price || 0).toLocaleString("en-IN")}</div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Size</span>
                  <select className="cart-size-select" value={l.size || ""} onChange={(e) => changeSize(l, e.target.value)} aria-label="Change size">
                    {!l.size && <option value="">—</option>}
                    {l.size && <option value={l.size}>{l.size}</option>}
                    {(l.sizes || []).filter((s) => s && s !== l.size).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="qty">
                    <button type="button" onClick={() => bump(l, (l.qty || 1) - 1)} aria-label="Decrease quantity">−</button>
                    <span>{l.qty}</span>
                    <button type="button" onClick={() => bump(l, (l.qty || 1) + 1)} aria-label="Increase quantity">+</button>
                  </div>
                  {l.stock != null && l.stock <= 5 && <span style={{ fontSize: 11, color: "var(--danger)" }}>only {l.stock} left</span>}
                </div>
                <button type="button" className="rm" onClick={() => { remove(l.key); toast("Item removed from cart"); }}>Remove</button>
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
          <div className="sum-row"><span>Subtotal ({itemCount} items)</span><span>৳{subtotal.toLocaleString("en-IN")}</span></div>
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
