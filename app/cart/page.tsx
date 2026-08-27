"use client";
import Link from "next/link";
import { useState } from "react";
import { useCart, trackEvent, toast } from "@/components/store";

export default function CartPage() {
  const { lines, subtotal, setQty, remove, ready } = useCart();
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  // shipping preview uses defaults; exact fee computed server-side at checkout
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
              <Link href={"/products/" + l.slug}><img src={l.image} alt={l.title} /></Link>
              <div>
                <div className="t"><Link href={"/products/" + l.slug}>{l.title}</Link></div>
                <div className="v">{[l.size, l.color].filter(Boolean).join(" · ")}</div>
                <div className="v">৳{l.price.toLocaleString("en-IN")}</div>
                <div style={{ marginTop: 10 }}>
                  <div className="qty" style={{ transform: "scale(.88)", transformOrigin: "left" }}>
                    <button onClick={() => setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
                  </div>
                </div>
                <button className="rm" onClick={() => remove(l.key)}>Remove</button>
              </div>
              <div style={{ fontWeight: 600 }}>৳{(l.price * l.qty).toLocaleString("en-IN")}</div>
            </div>
          ))}
        </div>
        <aside className="summary">
          <h3>Order Summary</h3>
          <div className="freeship-note">
            {remaining > 0 ? <>Add <b>৳{remaining.toLocaleString("en-IN")}</b> more for free delivery</> : <>🎉 You&apos;ve unlocked <b>free delivery</b></>}
          </div>
          <div className="freebar"><i style={{ width: Math.min(100, (subtotal / FREE_T) * 100) + "%" }} /></div>
          <div className="sum-row"><span>Subtotal</span><span>৳{subtotal.toLocaleString("en-IN")}</span></div>
          {discount > 0 && <div className="sum-row" style={{ color: "var(--ok)" }}><span>Discount ({applied.code})</span><span>−৳{discount.toLocaleString("en-IN")}</span></div>}
          <div className="sum-row"><span>Delivery (est.)</span><span>{(applied?.freeship || ship === 0) ? "Free" : "৳" + ship}</span></div>
          <div className="sum-row total"><span>Total</span><span>৳{total.toLocaleString("en-IN")}</span></div>
          <div className="coupon-row">
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
            <button className="abtn" onClick={applyCoupon} disabled={busy}>Apply</button>
          </div>
          <Link className="btn" style={{ width: "100%" }} href="/checkout" onClick={() => trackEvent("InitiateCheckout", { value: total, currency: "BDT", contents: lines.map((l) => ({ id: String(l.productId), quantity: l.qty })) })}>Proceed to Checkout</Link>
          <div className="trust">
            <span>🔒 Secure checkout</span><span>💵 Cash on Delivery</span><span>↩ 7-day returns</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
