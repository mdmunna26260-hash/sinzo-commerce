"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, trackEvent, toast, captureAttribution, newEventId } from "@/components/store";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { imgSrc } from "@/components/parts";

declare global { interface Window { __SZ_SHIPPING?: any; __SZ_CHECKOUT?: any } }

export default function CheckoutPage() {
  const { lines, subtotal, clear, ready, setQty, remove } = useCart();
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
  const [cbusy, setCBusy] = useState(false);
  const [giftWrap, setGiftWrap] = useState(false);
  const GIFT_WRAP_PRICE = 50;
  const [payment, setPayment] = useState("COD");

  // ---- saved address book (logged-in customers) ----
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<number | "new">("new");
  const [loggedIn, setLoggedIn] = useState(false);
  const [saveAddr, setSaveAddr] = useState(true);

  const discount = applied ? applied.discount : 0;
  const ship = applied?.freeship || subtotal - discount >= freeT ? 0 : form.area === "INSIDE_DHAKA" ? inside : outside;
  const total = Math.max(0, subtotal - discount) + ship;

  useEffect(() => {
    // prefill from customer account (cookie or ?ct= token) + saved address book
    (async () => {
      try {
        const ct = new URLSearchParams(location.search).get("ct");
        const headers: HeadersInit = ct ? { Authorization: "Bearer " + ct } : {};
        const r = await fetch("/api/auth/me", { headers });
        if (!r.ok) return;
        const j = await r.json();
        const c = j.customer || {};
        const book: any[] = Array.isArray(j.addresses) ? j.addresses : [];
        setLoggedIn(true);
        setAddresses(book);
        const def = book.find((a) => a.isDefault) || book[0];
        if (def) {
          setSelectedAddr(def.id);
          setSaveAddr(false);
          setForm((f) => ({
            ...f,
            name: f.name || def.name || c.name || "",
            phone: f.phone || def.phone || c.phone || "",
            email: f.email || c.email || "",
            address: def.address || c.address || "",
            area: def.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : c.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : f.area,
          }));
        } else {
          setForm((f) => ({
            ...f,
            name: f.name || c.name || "",
            phone: f.phone || c.phone || "",
            email: f.email || c.email || "",
            address: f.address || c.address || "",
            area: c.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : f.area,
          }));
        }
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (lines.length === 0) return;
    // capture as abandoned ONLY after customer fills phone + name + address
    const filled = form.phone.replace(/[\s-]/g, "").length === 11 && form.name.trim().length >= 3 && form.address.trim().length >= 10;
    if (!filled) return;
    trackEvent("InitiateCheckout", { value: subtotal, currency: "BDT", contents: lines.map((l) => ({ id: String(l.productId), quantity: l.qty })) });
    fetch("/api/checkout/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      items: lines.map((l) => ({ title: l.title, qty: l.qty, price: l.price })), total: subtotal,
      phone: form.phone.replace(/[\s-]/g, ""), name: form.name.trim(), address: form.address.trim(),
    }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, form.phone, form.name, form.address]);

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

  const ctToken = () => { try { return new URLSearchParams(location.search).get("ct") || ""; } catch { return ""; } };

  const pickAddress = (a: any) => {
    setSelectedAddr(a.id);
    setForm((f) => ({ ...f, name: a.name || f.name, phone: a.phone || f.phone, address: a.address, area: a.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : "INSIDE_DHAKA" }));
    setErrors((e: any) => ({ ...e, address: undefined, name: undefined, phone: undefined }));
  };
  const startNewAddress = () => {
    setSelectedAddr("new");
    setSaveAddr(true);
    setForm((f) => ({ ...f, address: "" }));
    setErrors((e: any) => ({ ...e, address: undefined }));
  };

  const applyCoupon = async () => {
    if (!coupon.trim() || cbusy || busy) return;
    setCBusy(true);
    try {
      const r = await fetch("/api/coupon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: coupon.trim(), subtotal }) });
      const j = await r.json();
      if (r.ok && j.valid) { setApplied(j); toast(`Coupon ${j.code} applied ✓`); } else { setApplied(null); toast(j.error || "Invalid coupon"); }
    } catch { toast("Network error"); }
    setCBusy(false);
  };

  const validate = (): boolean => {
    const e: any = {};
    if (!form.name.trim() || form.name.trim().length < 3) e.name = "Please enter your full name";
    const normalizedPhone = normalizeBDPhone(form.phone);
    if (!isValidBDPhone(normalizedPhone)) e.phone = "Enter a valid BD mobile number (01676450711 or +8801676450711)";
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
          ...form, phone: normalizeBDPhone(form.phone), paymentMethod: payment,
      giftWrap,
          couponCode: applied?.code || null, purchaseEventId: eventId,
          attribution: captureAttribution(),
          items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId || null, qty: l.qty })),
        }),
      });
      const j = await r.json();
      if (r.ok) {
        // save to address book (logged-in + new address + opted in) — non-blocking for UX
        if (loggedIn && saveAddr && selectedAddr === "new" && form.address.trim().length >= 10) {
          const dup = addresses.find((a) => a.address.trim() === form.address.trim() && a.phone === normalizeBDPhone(form.phone));
          if (!dup) {
            await fetch("/api/addresses", {
              method: "POST", headers: { "Content-Type": "application/json", ...(ctToken() ? { Authorization: "Bearer " + ctToken() } : {}) },
              body: JSON.stringify({ name: form.name.trim(), phone: normalizeBDPhone(form.phone), address: form.address.trim(), area: form.area, label: "Other" }),
            }).catch(() => {});
          }
        }
        clear();
        const ids = [...new Set(lines.map((l) => String(l.productId)))].join(",");
        const num = lines.reduce((s, l) => s + l.qty, 0);
        router.push(`/order/success?code=${j.code}&total=${j.total}&eid=${encodeURIComponent(eventId)}&ids=${ids}&num=${num}&ph=${encodeURIComponent(normalizeBDPhone(form.phone))}`);
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
            {addresses.length > 0 && (
              <div className="addr-list" style={{ marginBottom: 18 }}>
                {addresses.map((a) => (
                  <div key={a.id} className={"addr-chip" + (selectedAddr === a.id ? " active" : "")} role="button" tabIndex={0}
                    onClick={() => pickAddress(a)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickAddress(a); } }}>
                    <div className="addr-chip-top">
                      <b>{a.label}</b>
                      {a.isDefault && <span className="tag">DEFAULT</span>}
                    </div>
                    <div className="addr-chip-meta">{a.name} · {a.phone}</div>
                    <div className="addr-chip-txt">{a.address}</div>
                  </div>
                ))}
                <div className={"addr-chip addnew" + (selectedAddr === "new" ? " active" : "")} role="button" tabIndex={0}
                  onClick={startNewAddress} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startNewAddress(); } }}>
                  <b>+ New address</b>
                  <div className="addr-chip-txt">Different address diye pathate chan?</div>
                </div>
              </div>
            )}
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
            {loggedIn && selectedAddr === "new" && (
              <label className="saveaddr-row">
                <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} style={{ width: 15, height: 15 }} />
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Save this address to my address book</span>
              </label>
            )}
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

          <div className="acard" style={{ padding: "14px 18px", marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={giftWrap} onChange={(e) => setGiftWrap(e.target.checked)} style={{ width: 16, height: 16 }} />
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13.5 }}>🎁 Gift Wrap</b>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Premium packaging + gift note</div>
              </div>
              <b style={{ fontSize: 13 }}>+৳{GIFT_WRAP_PRICE}</b>
            </label>
          </div>

          <div className="acard" style={{ padding: "16px 18px", marginBottom: 8 }}>
            <h3 style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Payment Method</h3>
            {codEnabled && (
              <div className={"pay-opt" + (payment === "COD" ? " active" : "")} onClick={() => setPayment("COD")}>
                <input type="radio" checked={payment === "COD"} readOnly />
                <div>
                  <b>Cash on Delivery</b>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Pay with cash when the parcel arrives.</div>
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
              <img src={imgSrc(l.image, 300) || l.image} alt="" width={52} height={66} loading="lazy" decoding="async" />
              <div style={{ flex: 1 }}>
                <div className="m">{l.title}</div>
                <div className="s">{[l.size, l.color].filter(Boolean).join(" · ")}</div>
                <div className="mini-qty">
                  <button type="button" onClick={() => setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
                  <span>{l.qty}</span>
                  <button type="button" onClick={() => setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <button type="button" className="mini-del" onClick={() => remove(l.key)} aria-label="Remove item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>
                  <span style={{ fontSize: 10.5, marginLeft: 2 }}>Remove</span>
                </button>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>৳{(l.price * l.qty).toLocaleString("en-IN")}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <div className="sum-row"><span>Subtotal</span><span>৳{subtotal.toLocaleString("en-IN")}</span></div>
            {discount > 0 && <div className="sum-row" style={{ color: "var(--ok)" }}><span>Discount ({applied.code})</span><span>−৳{discount.toLocaleString("en-IN")}</span></div>}
            <div className="sum-row"><span>Delivery</span><span>{ship === 0 ? "Free" : "৳" + ship}</span></div>
            <div className="sum-row total"><span>Total</span><span>৳{total.toLocaleString("en-IN")}</span></div>
          </div>
          <div className="coupon-row">
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} disabled={busy} />
            <button className="abtn" onClick={applyCoupon} type="button" disabled={busy || cbusy} aria-busy={cbusy || undefined}>
              {cbusy && <span className="spinner" aria-hidden="true" />}{cbusy ? "Checking" : "Apply"}
            </button>
          </div>
          <button className="btn btn-accent" style={{ width: "100%" }} onClick={placeOrder} disabled={busy} aria-busy={busy || undefined}>
            {busy && <span className="spinner" aria-hidden="true" />}
            <span style={busy ? { marginLeft: 8 } : undefined}>
              {busy ? "Processing Order…" : `Place Order · ৳${total.toLocaleString("en-IN")}`}
            </span>
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, textAlign: "center" }}>
            Estimated delivery: {form.area === "INSIDE_DHAKA" ? shipCfg.estimateInside || "1-2 days" : shipCfg.estimateOutside || "2-4 days"}
          </p>
        </aside>
      </div>
    </div>
  );
}
