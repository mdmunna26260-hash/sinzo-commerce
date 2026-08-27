"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart, toast } from "@/components/store";

/* Cart — reference design: live qty, per-line Total pill, size change, remove.
   Every change updates instantly (deep-copied state) + confirmation toast. */
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
      } else {
        toast(`Size ${newSize} is out of stock`);
      }
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
    <div className="container cart-page">
      <div className="cart-head">
        <div className="eyebrow">Shopping Cart</div>
        <h1>Your Cart</h1>
        <p className="cart-sub">{itemCount} item{itemCount !== 1 ? "s" : ""} in your cart</p>
        <Link className="btn btn-outline cart-continue" href="/products">Continue Shopping</Link>
      </div>

      <div className="cart-layout">
        <div className="cart-lines">
          {lines.map((l) => (
            <div className="ccard" key={l.key}>
              <Link href={"/products/" + l.slug} className="ccard-img">
                {l.image && <img src={l.image} alt={l.title} loading="lazy" decoding="async" />}
              </Link>
              <div className="ccard-body">
                <Link href={"/products/" + l.slug} className="ccard-title">{l.title}</Link>
                {(l.color || l.size) && (
                  <div className="ccard-meta">
                    {l.color && <span>{l.color}</span>}
                    {l.size && <span className="pill-pill">Size: {l.size}</span>}
                  </div>
                )}
                <div className="ccard-row">
                  <div className="qty-pill" role="group" aria-label="Quantity">
                    <button type="button" aria-label="Decrease" onClick={() => bump(l, (l.qty || 1) - 1)}>−</button>
                    <span>{l.qty}</span>
                    <button type="button" aria-label="Increase" onClick={() => bump(l, (l.qty || 1) + 1)}>+</button>
                  </div>
                  <div className="total-pill">Total: {Number(l.price * l.qty).toLocaleString("en-IN")}-BDT</div>
                </div>
                <button type="button" className="remove-btn" onClick={() => { remove(l.key); toast("Item removed from cart"); }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/></svg>
                  Remove
                </button>
                {l.stock != null && l.stock <= 5 && <div className="ccard-low">Only {l.stock} left in stock</div>}
              </div>
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
          <Link className="btn btn-accent" style={{ width: "100%" }} href="/checkout">Proceed to Checkout</Link>
          <div className="trust">
            <span>🔒 Secure checkout</span><span>💵 Cash on Delivery</span><span>↩ 7-day returns</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
