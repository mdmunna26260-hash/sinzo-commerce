"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { imgSrc } from "@/components/img-src";

const TONE: Record<string, string> = { ok: "var(--ok)", warn: "#9a7b1e", bad: "var(--danger)", info: "var(--text)" };
const STEPS = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];
// Same BDT formatting the account panel uses, so a number never reads differently in two places.
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");
const dayMonthYear = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const LABEL: Record<string, string> = { COD: "Cash on Delivery", BKASH: "bKash", NAGAD: "Nagad", SSLCOMMERZ: "Card / SSLCommerz" };
const PAY: Record<string, string> = { PENDING: "not paid yet", PAID: "paid", FAILED: "payment failed", REFUNDED: "refunded" };

export default function TrackClient() {
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") || sp.get("t") || "");
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem("sz_track_phone") || ""; } catch { return ""; } });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const lookup = async (c: string) => {
    if (!c.trim()) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const qs = new URLSearchParams({ code: c.trim() });
      if (phone.trim()) qs.set("phone", phone.trim());
      try { localStorage.setItem("sz_track_phone", phone.trim()); } catch {}
      const r = await fetch("/api/track/courier?" + qs.toString());
      const j = await r.json();
      if (r.ok) setResult(j); else setErr(j.error || "We couldn't find that order — check the code and mobile number.");
    } catch { setErr("Network error — please try again."); }
    setBusy(false);
  };
  useEffect(() => { const c = sp.get("code") || sp.get("t"); if (c) lookup(c); /* eslint-disable-next-line */ }, []);

  const currentIdx = result ? STEPS.indexOf(result.status) : -1;
  const isCancelled = result?.status === "CANCELLED" || result?.status === "RETURNED";

  const items: any[] = result?.items || [];
  const totalQty = items.reduce((a: number, i: any) => a + (i.qty || 1), 0);
  const itemsSum = items.reduce((a: number, i: any) => a + (i.price ? i.price * (i.qty || 1) : 0), 0);
  // Only print a per-line total when the item lines actually add up to the order's subtotal. Legacy /
  // imported rows can hold a unit price that predates a later edit; showing ৳5,700 next to a ৳2,850
  // subtotal would read as a billing error to a customer, so the line total is simply left blank.
  const lineTotalsOK = result?.subtotal == null || Math.abs(itemsSum - Number(result.subtotal)) <= 1;
  const unit = (i: any) => (i.price ? money(i.price) + " each" : "");
  const line = (i: any) => (i.price && lineTotalsOK ? money(i.price * (i.qty || 1)) : "");

  return (
    <div className="track-wrap" style={{ maxWidth: 640, margin: "0 auto" }}>
      <div className="eyebrow">Order tracking</div>
      <h1 style={{ fontSize: "clamp(28px,3.4vw,38px)", margin: "8px 0 6px" }}>Where&apos;s my parcel?</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 22 }}>
        Enter your courier tracking number or consignment ID. Using an <b>ORD-… order code</b>? Add the mobile number you ordered with.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
        <div style={{ display: "grid", gap: 12 }}>
          <input
            placeholder="Tracking number or ORD-XXXX"
            value={code} onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters" spellCheck={false} autoComplete="off"
            style={{ fontSize: 16, minHeight: 52, padding: "0 16px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff", width: "100%", letterSpacing: ".04em" }}
          />
          <input
            type="tel" inputMode="numeric" placeholder="Mobile number (01XXXXXXXXX)"
            value={phone} onChange={(e) => setPhone(e.target.value)}
            style={{ fontSize: 16, minHeight: 52, padding: "0 16px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff", width: "100%", letterSpacing: ".04em" }}
          />
        </div>
        <button className="btn" style={{ width: "100%", marginTop: 14, minHeight: 50, borderRadius: 10 }} disabled={busy || !code.trim()} type="submit">
          {busy ? "Checking…" : "Track Order"}
        </button>
      </form>

      {err && <div className="noti err" style={{ marginTop: 18 }}>{err}</div>}

      {result && (
        <div style={{ marginTop: 28 }}>
          {/* Status header */}
          <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "22px 20px", marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>Order</div>
                <b style={{ fontSize: 17 }}>{result.code}</b>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>Placed on</div>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {result.createdAt ? new Date(result.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                </span>
              </div>
            </div>

            {/* Stepper */}
            {isCancelled ? (
              <div style={{ marginTop: 18, padding: "12px 16px", background: "#fff5f2", border: "1px solid #f3d9d3", borderRadius: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--danger)" }}>{result.status}</span>
                {result.notice && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{result.notice}</div>}
              </div>
            ) : currentIdx >= 0 ? (
              <div style={{ display: "flex", alignItems: "flex-start", marginTop: 20, marginBottom: 8 }}>
                {STEPS.map((step, i) => {
                  const done = i <= currentIdx;
                  const isLast = i === STEPS.length - 1;
                  return (
                    <div key={step} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                      {!isLast && (
                        <div style={{ position: "absolute", top: 9, left: "50%", width: "100%", height: 2.5, background: done ? "var(--accent)" : "var(--line)", zIndex: 0 }} />
                      )}
                      <div style={{
                        width: 20, height: 20, borderRadius: 99, zIndex: 1,
                        background: done ? "var(--accent)" : "#fff",
                        border: done ? "2px solid var(--accent)" : "2px solid var(--line)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {done && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M20 6 9 17l-5-5"/></svg>
                        )}
                      </div>
                      <span style={{ fontSize: 9, marginTop: 6, textAlign: "center", color: done ? "var(--text)" : "var(--muted)", fontWeight: done ? 600 : 400, letterSpacing: ".02em" }}>
                        {step.charAt(0) + step.slice(1).toLowerCase()}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Courier info */}
            {result.courierName && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 14px", background: "#f8f7f5", borderRadius: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{result.courierName}</span>
                {result.consignmentId && <span style={{ fontSize: 12, color: "var(--muted)" }}>· {result.consignmentId}</span>}
                {result.source === "steadfast" && <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ok)" }}>● Live</span>}
              </div>
            )}
            {result.notice && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{result.notice}</div>}
          </div>

          {/* What you ordered: thumbnail + variant + per-line price, then the money breakdown.
              The courier/order API payload (app/api/track/*) carries items[], subtotal, total. */}
          <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
              What you ordered{items.length ? ` · ${totalQty} item${totalQty === 1 ? "" : "s"}` : ""}
            </div>
            {items.map((i: any, k: number) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: k === items.length - 1 ? "none" : "1px dashed var(--line)" }}>
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imgSrc(i.image, 300)} alt="" width={38} height={48} loading="lazy" decoding="async"
                    style={{ width: 38, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", flex: "0 0 auto" }} />
                ) : (
                  <span aria-hidden style={{ width: 38, height: 48, borderRadius: 6, border: "1px dashed var(--line)", flex: "0 0 auto", display: "inline-block" }} />
                )}
                <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5 }}>{i.title}{i.variant ? <span style={{ color: "var(--muted)" }}> · {i.variant}</span> : null}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    Qty {i.qty}{i.price ? ` · ${unit(i)}` : ""}{i.preorder ? " · pre-order" : ""}
                    {i.preorderDate ? ` (est. ${dayMonthYear(i.preorderDate)})` : ""}
                  </span>
                </span>
                <b style={{ fontSize: 13.5, flex: "0 0 auto" }}>{line(i)}</b>
              </div>
            ))}
            {items.length === 0 && result.source !== "steadfast" && (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Item list for this order isn&apos;t available here — use your ORD- code with the mobile number you ordered with, or WhatsApp us.
              </div>
            )}

            {result.total != null && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                {result.subtotal != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--muted)" }}>
                    <span>Subtotal</span><span>{money(result.subtotal)}</span>
                  </div>
                )}
                {!!result.discount && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--ok)" }}>
                    <span>Discount{result.couponCode ? ` (${result.couponCode})` : ""}</span><span>−{money(result.discount)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--muted)" }}>
                  <span>Delivery{result.area === "INSIDE_DHAKA" ? " (inside Dhaka)" : result.area ? " (outside Dhaka)" : ""}</span>
                  <span>{result.deliveryFee ? money(result.deliveryFee) : "Free"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 2px", borderTop: "2px solid var(--text)", marginTop: 6 }}>
                  <b>Total</b><b>{money(result.total)}</b>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  {LABEL[result.paymentMethod] || result.paymentMethod || "Cash on Delivery"}
                  {result.paymentStatus ? ` · ${PAY[result.paymentStatus] || result.paymentStatus.toLowerCase()}` : ""}
                </div>
              </div>
            )}

            {result.otherOrders?.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>Other orders on this number</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {result.otherOrders.map((o: any) => (
                    <button key={o.code} type="button" onClick={() => { setCode(o.code); lookup(o.code); }}
                      style={{ font: "inherit", fontSize: 12.5, padding: "6px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", cursor: "pointer" }}>
                      <b>{o.code}</b> · {dayMonthYear(o.createdAt)} · {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
