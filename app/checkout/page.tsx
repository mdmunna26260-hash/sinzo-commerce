"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, trackEvent, toast, captureAttribution, newEventId, setTrackingPhone } from "@/components/store";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { imgSrc, imgSrcSet } from "@/components/parts";
import { checkoutTotals, couponDiscount, nonNegativeAmount } from "@/lib/checkout-pricing";
import { getCaptureKey, nextCaptureRevision, clearCaptureKey, captureSignature, PENDING_RECOVERY_KEY } from "@/lib/recovery-client";

declare global { interface Window { __SZ_SHIPPING?: any; __SZ_CHECKOUT?: any } }

export default function CheckoutPage() {
  const { lines, subtotal, clear, ready, setQty, remove, replace } = useCart();
  const router = useRouter();
  const cfg = useMemo(() => {
    try { return JSON.parse(document.getElementById("sz-cfg")?.textContent || "{}"); } catch { return {}; }
  }, []);
  const [recoveryPricing, setRecoveryPricing] = useState<any>(null);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryStage, setRecoveryStage] = useState("idle");
  const [recoveryRequest, setRecoveryRequest] = useState(0);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryWarnings, setRecoveryWarnings] = useState<string[]>([]);
  const [pendingRecovery, setPendingRecovery] = useState<any>(null);
  const recoveryActive = useRef(false);
  const orderInFlight = useRef(false);
  const currentLines = useRef(lines); currentLines.current = lines;
  const captureRequest = useRef<AbortController | null>(null);
  const purchaseEvent = useRef<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState("");
  const shipCfg = recoveryPricing?.shipping || cfg?.shipping || {};
  const inside = nonNegativeAmount(shipCfg.insideDhaka, 80);
  const outside = nonNegativeAmount(shipCfg.outsideDhaka, 140);
  const freeT = nonNegativeAmount(shipCfg.freeShippingThreshold);
  const checkoutCfg = recoveryPricing?.checkout || cfg?.checkout;
  const codEnabled = checkoutCfg?.codEnabled !== false;

  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", area: "INSIDE_DHAKA", notes: "" });
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [errors, setErrors] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [cbusy, setCBusy] = useState(false);
  const [giftWrap, setGiftWrap] = useState(false);
  const GIFT_WRAP_PRICE = nonNegativeAmount(checkoutCfg?.giftWrapFee, 60);
  const [payment, setPayment] = useState("COD");

  const discount = couponDiscount(subtotal, applied);
  const { deliveryFee: ship, total } = checkoutTotals({
    subtotal, discount, area: form.area, shipping: shipCfg, checkout: checkoutCfg,
    giftWrap, freeship: applied?.freeship,
  });

  useLayoutEffect(() => {
    const readLink = () => {
      const fragment = new URLSearchParams(location.hash.slice(1));
      let token = fragment.get("recover");
      if (token) {
        try { sessionStorage.setItem(PENDING_RECOVERY_KEY, token); } catch {}
        fragment.delete("recover");
        history.replaceState(history.state, "", location.pathname + location.search + (fragment.size ? "#" + fragment : ""));
      } else { try { token = sessionStorage.getItem(PENDING_RECOVERY_KEY); } catch {} }
      if (token) { recoveryActive.current = true; setRecoveryToken(token); setRecoveryStage("loading"); setRecoveryRequest(n => n + 1); }
    };
    readLink(); window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  const applyRecovery = (saved: any) => {
    clearCaptureKey();
    replace(saved.lines);
    setForm({ ...saved.contact, email: saved.contact.email || "", notes: saved.notes || "" });
    setGiftWrap(!!saved.giftWrap); setCoupon(saved.couponCode || ""); setApplied(saved.applied || null);
    setRecoveryPricing(saved.pricing || null); setRecoveryWarnings(saved.warnings || []);
    setPendingRecovery(null); setRecoveryStage("restored");
    setRecoveryMessage("Your saved cart is restored. Please review the current prices and delivery details.");
  };
  useEffect(() => {
    if (!recoveryToken || !ready) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/checkout/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: recoveryToken }), signal: controller.signal });
        const saved = await response.json();
        if (!response.ok) throw new Error(saved.error || "This recovery link could not be opened");
        if (!saved.lines.length) {
          setRecoveryStage("error"); setRecoveryMessage("The saved items are no longer available. Please browse our current products.");
          setRecoveryWarnings(saved.warnings || []); setRecoveryToken(null); recoveryActive.current = false; return;
        }
        const existing = currentLines.current;
        if (existing.length && captureSignature(existing) !== captureSignature(saved.lines)) {
          setPendingRecovery(saved); setRecoveryStage("choice"); setRecoveryMessage("You already have a different cart. Restore the saved cart or keep your current one?");
        } else applyRecovery(saved);
      } catch (e: any) {
        if (controller.signal.aborted) return;
        setRecoveryStage("error"); setRecoveryMessage(e.message || "Could not recover cart");
        setRecoveryToken(null); recoveryActive.current = false;
      } finally { if (!controller.signal.aborted) { try { sessionStorage.removeItem(PENDING_RECOVERY_KEY); } catch {} } }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryToken, ready, recoveryRequest]);

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
        if (recoveryActive.current) return;
        if (c.phone) setTrackingPhone(c.phone);
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
  }, [recoveryStage]);
  // guest phone typed → cache for Meta advanced matching (InitiateCheckout etc.)
  useEffect(() => {
    const p = form.phone.replace(/[\s-]/g, "");
    if (/^01[3-9]\d{8}$/.test(p)) setTrackingPhone(p);
  }, [form.phone]);

  useEffect(() => {
    if (!ready || !lines.length || busy || orderInFlight.current || ["loading", "choice"].includes(recoveryStage)) return;
    const phone = normalizeBDPhone(form.phone);
    if (!isValidBDPhone(phone) || form.name.trim().length < 3 || form.address.trim().length < 10) return;
    const key = getCaptureKey(); if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (orderInFlight.current) return;
      captureRequest.current = controller;
      setCaptureStatus("Saving checkout…");
      try {
        const response = await fetch("/api/checkout/start", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, keepalive: true, body: JSON.stringify({
          captureKey: key, revision: nextCaptureRevision(),
          items: lines.map(l => ({ productId: l.productId, variantId: l.variantId || null, qty: l.qty })),
          phone, name: form.name.trim(), address: form.address.trim(), email: form.email.trim(),
          area: form.area, notes: form.notes, giftWrap, couponCode: applied?.code || null,
        }) });
        const saved = await response.json();
        if (!response.ok) throw new Error();
        setCaptureStatus(saved.closed ? "" : "Checkout saved");
      } catch { if (!controller.signal.aborted) setCaptureStatus("Could not save cart changes. You can still try placing your order."); }
    }, 800);
    const saveOnLeave = () => {
      if (orderInFlight.current || controller.signal.aborted) return;
      const body = JSON.stringify({ captureKey: key, revision: nextCaptureRevision(), items: lines.map(l => ({ productId: l.productId, variantId: l.variantId || null, qty: l.qty })), phone, name: form.name.trim(), address: form.address.trim(), email: form.email.trim(), area: form.area, notes: form.notes, giftWrap, couponCode: applied?.code || null });
      navigator.sendBeacon?.("/api/checkout/start", new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", saveOnLeave);
    return () => { clearTimeout(timer); controller.abort(); window.removeEventListener("pagehide", saveOnLeave); };
  }, [ready, lines, form.phone, form.name, form.address, form.email, form.area, form.notes, giftWrap, applied?.code, busy, recoveryStage]);

  const recoveryBanner = recoveryStage !== "idle" ? (
    <div className={"recovery-banner " + (recoveryStage === "error" ? "error" : "")} role="status" aria-live="polite">
      <p>{recoveryStage === "loading" ? "Restoring your saved cart…" : recoveryMessage}</p>
      {recoveryWarnings.length > 0 && <ul>{recoveryWarnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      {pendingRecovery && <div className="recovery-actions">
        <button type="button" className="abtn primary" onClick={() => applyRecovery(pendingRecovery)}>Restore saved cart</button>
        <button type="button" className="abtn" onClick={() => { setPendingRecovery(null); setRecoveryToken(null); recoveryActive.current = false; setRecoveryStage("kept"); setRecoveryMessage("Your current cart was kept."); }}>Keep current cart</button>
      </div>}
    </div>
  ) : null;

  if (!ready || recoveryStage === "loading") {
    return (
      <div className="container" aria-busy="true">
        {recoveryBanner}
        <div className="cart-head" style={{ margin: "26px 0 18px" }}><div className="sk-line" style={{ width: 190, height: 26, margin: 0 }} /></div>
        {[0, 1].map((i) => (
          <div key={i} style={{ display: "flex", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="sk-block" style={{ width: 78, height: 104, margin: 0, flex: "none" }} />
            <div style={{ flex: 1 }}>
              <div className="sk-line" style={{ width: "52%", margin: "6px 0" }} />
              <div className="sk-line" style={{ width: "26%", margin: "6px 0" }} />
              <div className="sk-line" style={{ width: "18%", margin: "6px 0" }} />
            </div>
          </div>
        ))}
        <div className="sk-line" style={{ width: 150, height: 30, margin: "22px 0 0" }} />
        <span className="sr-only">Loading your cart…</span>
      </div>
    );
  }
  if (lines.length === 0 && !busy) {
    return (
      <div className="container">
        {recoveryBanner}
        <div className="empty" style={{ padding: "130px 20px" }}>
          <h3>Nothing to check out</h3>
          <p>Your cart is empty.</p><br /><Link className="btn" href="/products">Browse Products</Link>
        </div>
      </div>
    );
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));


  const applyCoupon = async () => {
    if (!coupon.trim() || cbusy || busy) return;
    setCBusy(true);
    try {
      const r = await fetch("/api/coupon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: coupon.trim(), subtotal, phone: normalizeBDPhone(form.phone) || undefined }) });
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
    if (busy || cbusy || !codEnabled || recoveryStage === "choice") return;
    if (!validate()) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    orderInFlight.current = true; captureRequest.current?.abort(); setBusy(true);
    trackEvent("AddPaymentInfo", { value: total, currency: "BDT" });
    // Purchase does NOT fire here — it fires on the thank-you page after the
    // order is actually created (accurate conversion + Meta dedup via shared event_id).
    const eventId = purchaseEvent.current || (purchaseEvent.current = newEventId());
    try {
      const r = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, phone: normalizeBDPhone(form.phone), paymentMethod: payment,
          captureKey: getCaptureKey(), recoveryToken: recoveryStage === "restored" ? recoveryToken : undefined,
      giftWrap,
          couponCode: applied?.code || null, purchaseEventId: eventId,
          attribution: captureAttribution(),
          items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId || null, qty: l.qty })),
        }),
      });
      const j = await r.json();
      if (r.ok) {
        clearCaptureKey(); clear();
        const ids = [...new Set(lines.map((l) => String(l.productId)))].join(",");
        const num = lines.reduce((s, l) => s + l.qty, 0);
        router.push(`/order/success?code=${j.code}&total=${j.total}&eid=${encodeURIComponent(eventId)}&ids=${ids}&num=${num}&ph=${encodeURIComponent(normalizeBDPhone(form.phone))}`);
      } else {
        toast(j.error || "Could not place order");
        if (j.errors) setErrors(j.errors);
        orderInFlight.current = false; setBusy(false);
      }
    } catch {
      toast("Network error — please try again");
      orderInFlight.current = false; setBusy(false);
    }
  };

  return (
    <div className="container checkout-page">
      {recoveryBanner}
      <h1 className="checkout-h1">Checkout</h1>
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
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" autoComplete="email" />
                <div className="s" style={{ marginTop: 5 }}>Order updates and one reminder if you leave checkout unfinished.</div>
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
          {freeT > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, marginBottom: 6, color: "var(--muted)" }}>
                {subtotal - discount >= freeT
                  ? <span style={{ color: "var(--ok)", fontWeight: 600 }}>🎉 You&apos;ve unlocked FREE delivery</span>
                  : <>Add <b style={{ color: "var(--text)" }}>৳{Math.max(0, freeT - (subtotal - discount)).toLocaleString("en-IN")}</b> more for <b>FREE delivery</b></>}
              </div>
              <div className="freebar"><i style={{ width: Math.min(100, ((subtotal - discount) / freeT) * 100) + "%" }} /></div>
            </div>
          )}
          {lines.map((l) => (
            <div className="mini-item" key={l.key}>
              <img src={imgSrc(l.image, 200) || l.image} srcSet={imgSrcSet(l.image, [200, 300])} sizes="52px" alt="" width={52} height={66} loading="lazy" decoding="async" />
              <div style={{ flex: 1 }}>
                <div className="m">{l.title}{l.preorder && <span className="po-tag">Pre-order</span>}</div>
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
            {giftWrap && <div className="sum-row"><span>Gift Wrap</span><span>+৳{GIFT_WRAP_PRICE}</span></div>}
            <div className="sum-row total"><span>Total</span><span>৳{total.toLocaleString("en-IN")}</span></div>
          </div>
          <div className="coupon-row">
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} disabled={busy} aria-label="Coupon code" />
            <button className="abtn" onClick={applyCoupon} type="button" disabled={busy || cbusy || !coupon.trim()} aria-busy={cbusy || undefined}>
              {cbusy && <span className="spinner" aria-hidden="true" />}{cbusy ? "Checking" : "Apply"}
            </button>
          </div>
          {applied && (
            <div className="coupon-applied">
              <span className="promo-badge ok">🎟️ Coupon <b>{applied.code}</b> applied{discount > 0 && <> · −৳{discount.toLocaleString("en-IN")}</>}</span>
              <button type="button" className="promo-remove" onClick={() => { setApplied(null); setCoupon(""); }} aria-label="Remove coupon">✕</button>
            </div>
          )}
          {captureStatus && <p className="checkout-capture-status" aria-live="polite">{captureStatus}</p>}
          <button className="btn btn-accent" style={{ width: "100%" }} onClick={placeOrder} disabled={busy || cbusy || !codEnabled || recoveryStage === "choice"} aria-busy={busy || undefined}>
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
