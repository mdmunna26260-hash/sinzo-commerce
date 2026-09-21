"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { imgSrc, imgSrcSet } from "@/components/img-src";

const TONE: Record<string, string> = { ok: "var(--ok)", warn: "#9a7b1e", bad: "var(--danger)", info: "var(--text)" };
const STEPS = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];
// Same BDT formatting the account panel uses, so a number never reads differently in two places.
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");
const dayMonthYear = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const LABEL: Record<string, string> = { COD: "Cash on Delivery", BKASH: "bKash", NAGAD: "Nagad", SSLCOMMERZ: "Card / SSLCommerz" };
const PAY: Record<string, string> = { PENDING: "not paid yet", PAID: "paid", FAILED: "payment failed", REFUNDED: "refunded" };

/* Courier timestamps arrive in whatever shape the integration has this month —
   "2026-09-15 11:20:00" parses in Chrome and fails in Safari, so normalise before Date(). */
const cdate = (v?: string | null) => {
  if (!v) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const fixed = /\d{4}-\d{2}-\d{2}[ T]\d{2}:/.test(raw) && !/Z|[+-]\d{2}:?\d{2}$/.test(raw) ? raw.replace(" ", "T") : raw;
  const d = new Date(/^\d+$/.test(fixed) ? Number(fixed) * (fixed.length <= 10 ? 1000 : 1) : fixed);
  return isNaN(d.getTime()) ? null : d;
};
const stamp = (v?: string | null) => { const d = cdate(v); return d ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : (v || ""); };
const ago = (v?: string | null) => {
  const d = cdate(v); if (!d) return "";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return dayMonthYear(d.toISOString());
};

export default function TrackClient() {
  const sp = useSearchParams();
  // One field for everything: courier tracking number, consignment ID, ORD-… code or a mobile
  // number. The endpoint works out which one it is, so the page never asks "which is it?".
  const [code, setCode] = useState(sp.get("code") || sp.get("t") || "");
  // The phone is only ever needed to unlock an ORD-… code. It arrives from the account page's
  // link, or from this browser's last lookup, and stays OUT of the URL and off the screen unless
  // the server actually asks for it.
  const [phone, setPhone] = useState(() => sp.get("phone") || (() => { try { return localStorage.getItem("sz_track_phone") || ""; } catch { return ""; } })());
  const [askPhone, setAskPhone] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const lookup = async (c: string, mode: "search" | "refresh" = "search") => {
    const v = (c || "").trim();
    if (!v) return;
    if (mode === "refresh") setRefreshing(true); else { setBusy(true); setErr(""); setResult(null); }
    try {
      const qs = new URLSearchParams({ q: v });
      if (phone.trim()) qs.set("phone", phone.trim());
      if (mode === "refresh") qs.set("refresh", "1");
      const r = await fetch("/api/track/courier?" + qs.toString());
      const j = await r.json();
      if (r.ok) { setResult(j); setAskPhone(false); }
      else if (j.needPhone) { setAskPhone(true); setErr(j.error || "Confirm the mobile number you ordered with."); }
      else setErr(j.error || "We couldn't find that order — check the code and mobile number.");
    } catch { setErr(mode === "refresh" ? "Couldn't refresh right now." : "Network error — please try again."); }
    if (mode === "refresh") setRefreshing(false); else setBusy(false);
  };
  useEffect(() => { const c = sp.get("code") || sp.get("t"); if (c) lookup(c); /* eslint-disable-next-line */ }, []);

  // The endpoint sends a customer-facing LABEL in `status` ("Shipped", "Order Received
  // (Pending)") and the raw enum in `orderStatus`. The stepper and the cancelled branch need
  // the enum — matching STEPS against the label silently killed the progress bar for every
  // order that is not already with the courier.
  const currentIdx = result ? STEPS.indexOf(result.orderStatus || "") : -1;
  const isCancelled = result?.orderStatus === "CANCELLED" || result?.orderStatus === "RETURNED";

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
        One box, anything you have: courier tracking number, consignment ID, your <b>ORD-…</b> code — or just the mobile number you ordered with.
      </p>
      <form className="trk-form" onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
        <label className="sr-only" htmlFor="trk-q">Tracking number, consignment ID or order code</label>
        <input
          id="trk-q" className="trk-input" placeholder="Tracking number / consignment ID / ORD-1001"
          value={code} onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters" spellCheck={false} autoComplete="off" enterKeyHint="go"
        />
        {askPhone && (
          <div className="trk-phone">
            <label htmlFor="trk-phone">Mobile number you ordered with</label>
            <input
              id="trk-phone" className="trk-input" type="tel" inputMode="numeric" autoComplete="tel-national"
              autoFocus placeholder="01XXXXXXXXX" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => {
                try { localStorage.setItem("sz_track_phone", phone.trim()); } catch {}
                // they just typed it — no need to press Track again
                if (/^01[3-9]\d{8}$/.test(phone.trim()) && code.trim()) lookup(code);
              }}
            />
            <span className="trk-hint">Only used to prove the code is yours. Never shown, never saved in the address bar.</span>
          </div>
        )}
        <button className="btn trk-go" disabled={busy || !code.trim()} type="submit">
          {busy ? "Checking…" : "Track Order"}
        </button>
      </form>

      {err && <div className="noti err" role="alert" style={{ marginTop: 18 }}>{err}</div>}

      {result && (
        <div style={{ marginTop: 28 }}>
          {/* Live courier status — the answer to "where is it", straight from the courier */}
          {(result.live || result.source === "steadfast" || result.source === "stored") && (
            <div className="trk-live" role="status" aria-live="polite">
              <div className="trk-live-head">
                {/* dot and label are one flex item so a long courier name never strands the dot */}
                <span className="trk-live-flag">
                  <span className={"trk-dot" + (result.source === "stored" ? " trk-dot-stale" : "")} aria-hidden="true" />
                  <span className="trk-live-meta">
                    {result.source === "stored"
                      ? "Last recorded status"
                      // "cached" is our throttle, not something a shopper needs to read: the
                      // answer is at most a minute old either way, so show when it was checked.
                      : "Live from " + (result.courierName || "Steadfast") + " · checked " + ago(result.checkedAt)}
                  </span>
                </span>
                {result.source !== "stored" && (
                  <button type="button" className="trk-refresh" onClick={() => lookup(code, "refresh")} disabled={refreshing}>
                    {refreshing ? "Checking…" : "Refresh"}
                  </button>
                )}
              </div>
              <div className="trk-status" style={{ color: TONE[result.tone] || TONE.info }}>{result.status}</div>
              {!!result.live?.updatedAt && <div className="trk-ev-meta">Courier update · {stamp(result.live.updatedAt)}</div>}
              {!!result.live?.events?.length && (
                <ol className="trk-timeline">
                  {result.live.events.map((ev: any, k: number) => (
                    <li key={k} className={k === result.live.events.length - 1 ? "now" : undefined}>
                      <div className="trk-ev-label">{ev.label}</div>
                      <div className="trk-ev-meta">{[ev.at ? stamp(ev.at) : null, ev.location].filter(Boolean).join(" · ") || "—"}</div>
                    </li>
                  ))}
                </ol>
              )}
              {(result.consignmentId || result.live?.trackingCode) && (
                <div className="trk-refs">
                  {result.consignmentId && <span>Consignment <b>{result.consignmentId}</b></span>}
                  {result.live?.trackingCode && <span>Tracking <b>{result.live.trackingCode}</b></span>}
                </div>
              )}
              {result.notice && <div className="trk-note">{result.notice}</div>}
            </div>
          )}

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
            {result.courierName && !(result.live || result.source === "steadfast" || result.source === "stored") && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 14px", background: "#f8f7f5", borderRadius: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{result.courierName}</span>
                {result.consignmentId && <span style={{ fontSize: 12, color: "var(--muted)" }}>· {result.consignmentId}</span>}
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
                  <img src={imgSrc(i.image, 200)} srcSet={imgSrcSet(i.image, [200, 300])} sizes="38px" alt="" width={38} height={48} loading="lazy" decoding="async"
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
