"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, trackEvent, toast, captureAttribution, newEventId } from "@/components/store";

declare global { interface Window { __SZ_SHIPPING?: any; __SZ_CHECKOUT?: any } }

export default function CheckoutPage() {
  const { lines, subtotal, clear, ready } = useCart();
  const router = useRouter();
  const cfg = useMemo(() => {
    try { return JSON.parse(document.getElementById("sz-cfg")?.textContent || "{}"); } catch { return {}; }
  }, []);
  const shipCfg = cfg?.shipping || {};
  const inside = Number(shipCfg.insideDhaka) || 80;
  const outside = Number(shipCfg.outsideDhaka) || 140;
  const freeT = Number(shipCfg.freeShippingThreshold) || 0;
  const codEnabled = cfg?.checkout?.codEnabled !== false;

  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", area: "INSIDE_DHAKA", notes: "" });
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [errors, setErrors] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState("COD");
  const started = useState(false);

  const ship = applied?.freeship || subtotal >= freeT ? 0 : form.area === "INSIDE_DHAKA" ? inside : outside;
  const discount = applied ? applied.discount : 0;
  const total = Math.max(0, subtotal - discount) + ship;

  useEffect(() => {
    // prefill from customer account (cookie or ?ct= token)
    (async () => {
      try {
        const ct = new URLSearchParams(location.search).get("ct");
        const headers: HeadersInit = ct ? { Authorization: "Bearer " + ct } : {};
        const r = await fetch("/api/auth/me", { headers });
        if (!r.ok) return;
        const j = await r.json();
        const c = j.customer || {};
        setForm((f) => ({
          ...f,
          name: f.name || c.name || "",
          phone: f.phone || c.phone || "",
          email: f.email || c.email || "",
          address: f.address || c.address || "",
          area: c.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : f.area,
        }));
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (started[0] || lines.length === 0) return;
    started[0] = true;
    trackEvent("InitiateCheckout", { value: subtotal, currency: "BDT", contents: lines.map((l) => ({ id: String(l.productId), quantity: l.qty })) });
    fetch("/api/checkout/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: lines.map((l) => ({ title: l.title, qty: l.qty, price: l.price })), total: subtotal }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  if (!ready) {
    return <div className="container"><div className="empty" style={{ padding: "130px 20px" }}><h3>Loading…</h3></div></div>;
  }
  if (lines.length === 0 && !busy) {
    return (
      <div className="container">
        <div className="empty" style={{ padding: "130px 20px" }}>
          <h3>Nothing to check out</h3>
          <p>Your cart is empty.</p><br /><Link className="btn" href="/products">Browse Products</Link>
        </div>
      </div>
    );
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const applyCoupon = async () => {
    const r = await fetch("/api/coupon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: coupon.trim(), subtotal }) });
    const j = await r.json();
    if (r.ok && j.valid) { setApplied(j); toast(`Coupon ${j.code} applied ✓`); } else { setApplied(null); toast(j.error || "Invalid coupon"); }
  };

  const validate = (): boolean => {
    const e: any = {};
    if (!form.name.trim() || form.name.trim().length < 3) e.name = "Please enter your full name";
    if (!/^01[3-9]\d{8}$/.test(form.phone.replace(/[\s-]/g, ""))) e.phone = "Enter a valid 11-digit BD mobile number (01XXXXXXXXX)";
    if (!form.address.trim() || form.address.trim().length < 10) e.address = "Please enter your full address (house, road, area)";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const placeOrder = async () => {
    if (!validate()) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setBusy(true);
    trackEvent("AddPaymentInfo", { value: total, currency: "BDT" });
    // Purchase does NOT fire here — it fires on the thank-you page after the
    // order is actually created (accurate conversion + Meta dedup via shared event_id).
    const eventId = newEventId();
    try {
      const r = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, phone: form.phone.replace(/[\s-]/g, ""), paymentMethod: payment,
          couponCode: applied?.code || null, purchaseEventId: eventId,
          attribution: captureAttribution(),
          items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId || null, qty: l.qty })),
        }),
      });
      const j = await r.json();
      if (r.ok) {
        clear();
        const ids = [...new Set(lines.map((l) => String(l.productId)))].join(",");
        const num = lines.reduce((s, l) => s + l.qty, 0);
        router.push(`/order/success?code=${j.code}&total=${j.total}&eid=${encodeURIComponent(eventId)}&ids=${ids}&num=${num}`);
      } else {
        toast(j.error || "Could not place order");
        if (j.errors) setErrors(j.errors);
        setBusy(false);
      }
    } catch {
      toast("Network error — please try again");
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ padding: "38px 24px 100px" }}>
      <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", marginBottom: 30 }}>Checkout</h1>
      <div className="checkout-layout">
        <div>
          <div className="acard" style={{ padding: 26, marginBottom: 20 }}>
            <h3 style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600, marginBottom: 18 }}>Delivery Information</h3>
            <div className="field-row">
              <div className="field">
                <label>Full Name *</label>
                <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rahim Ahmed" autoComplete="name" />
                {errors.name && <div className="err">{errors.name}</div>}
              </div>
              <div className="field">
                <label>Mobile Number *</label>
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="01XXXXXXXXX" inputMode="numeric" autoComplete="tel" />
                {errors.phone && <div className="err">{errors.phone}</div>}
              </div>
            </div>
            <div className="field">
              <label>Full Address *</label>
              <textarea value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="House / Road / Area, Thana, City" rows={2} style={{ minHeight: 0, resize: "vertical" }} />
              {errors.address && <div className="err">{errors.address}</div>}
            </div>
            <div className="field-row">
              <div className="field">
                <label>Delivery Zone</label>
                <select value={form.area} onChange={(e) => set("area", e.target.value)}>
                  <option value="INSIDE_DHAKA">Inside Dhaka — ৳{inside}</option>
                  <option value="OUTSIDE_DHAKA">Outside Dhaka — ৳{outside}</option>
                </select>
              </div>
              <div className="field">
                <label>Email (optional)</label>
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Order Notes (optional)</label>
              <input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any special instruction" />
            </div>
          </div>

          <div className="acard" style={{ padding: 26 }}>
            <h3 style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600, marginBottom: 18 }}>Payment Method</h3>
            {codEnabled && (
              <div className={"pay-opt" + (payment === "COD" ? " active" : "")} onClick={() => setPayment("COD")}>
                <input type="radio" checked={payment === "COD"} readOnly />
                <div>
                  <b>Cash on Delivery</b>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Pay with cash when the parcel arrives at your door.</div>
                </div>
                <span className="tag">RECOMMENDED</span>
              </div>
            )}
            {!codEnabled && <div className="cfg-note">Online payment gateway will appear here once configured from the admin panel.</div>}
            <div className="trust">
              <span>🔒 Your data is protected</span><span>↩ 7-day easy returns</span><span>📞 Phone support</span>
            </div>
          </div>
        </div>

        <aside className="summary">
          <h3>Your Order</h3>
          {lines.map((l) => (
            <div className="mini-item" key={l.key}>
              <img src={l.image} alt="" />
              <div style={{ flex: 1 }}>
                <div className="m">{l.title}</div>
                <div className="s">{[l.size, l.color].filter(Boolean).join(" · ")} × {l.qty}</div>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>৳{(l.price * l.qty).toLocaleString("en-IN")}</div>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <div className="sum-row"><span>Subtotal</span><span>৳{subtotal.toLocaleString("en-IN")}</span></div>
            {discount > 0 && <div className="sum-row" style={{ color: "var(--ok)" }}><span>Discount ({applied.code})</span><span>−৳{discount.toLocaleString("en-IN")}</span></div>}
            <div className="sum-row"><span>Delivery</span><span>{ship === 0 ? "Free" : "৳" + ship}</span></div>
            <div className="sum-row total"><span>Total</span><span>৳{total.toLocaleString("en-IN")}</span></div>
          </div>
          <div className="coupon-row">
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
            <button className="abtn" onClick={applyCoupon} type="button">Apply</button>
          </div>
          <button className="btn btn-accent" style={{ width: "100%" }} onClick={placeOrder} disabled={busy}>
            {busy ? "Placing order…" : `Place Order · ৳${total.toLocaleString("en-IN")}`}
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, textAlign: "center" }}>
            Estimated delivery: {form.area === "INSIDE_DHAKA" ? shipCfg.estimateInside || "1-2 days" : shipCfg.estimateOutside || "2-4 days"}
          </p>
        </aside>
      </div>
    </div>
  );
}
