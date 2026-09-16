"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const TONE: Record<string, string> = { ok: "var(--ok)", warn: "#9a7b1e", bad: "var(--danger)", info: "var(--text)" };
const STEPS = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];

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

          {/* Items */}
          <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>Items</div>
            {result.items?.map((i: any, k: number) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
                <span>{i.title}</span>
                <span style={{ color: "var(--muted)" }}>× {i.qty}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
