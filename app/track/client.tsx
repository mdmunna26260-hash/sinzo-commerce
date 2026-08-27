"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const STEPS = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];
const LABELS: Record<string, string> = {
  PENDING: "Order received", CONFIRMED: "Order confirmed", PROCESSING: "Processing",
  PACKED: "Packed", SHIPPED: "Shipped", DELIVERED: "Delivered",
};

export default function TrackClient() {
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") || "");
  const [phone, setPhone] = useState(sp.get("phone") || "");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const lookup = async (c: string, p: string) => {
    if (!c || !p) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/track/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c, phone: p }) });
      const j = await r.json();
      if (r.ok) setResult(j.order); else setErr(j.error || "Order not found");
    } catch { setErr("Network error"); }
    setBusy(false);
  };
  useEffect(() => { if (sp.get("code") && sp.get("phone")) lookup(code, phone); /* eslint-disable-next-line */ }, []);

  const currentIdx = result ? STEPS.indexOf(result.status) : -1;
  return (
    <div className="track-wrap">
      <div className="eyebrow">Order tracking</div>
      <h1 style={{ fontSize: "clamp(28px,3.4vw,38px)", margin: "8px 0 26px" }}>Where&apos;s my parcel?</h1>
      <form onSubmit={(e) => { e.preventDefault(); lookup(code, phone); }}>
        <div className="field"><label>Order Code</label><input placeholder="ORD-1001" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        <div className="field"><label>Phone number used at checkout</label><input placeholder="01XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <button className="btn" style={{ width: "100%" }} disabled={busy} type="submit">{busy ? "Checking…" : "Track Order"}</button>
      </form>
      {err && <div className="noti err" style={{ marginTop: 18 }}>{err}</div>}
      {result && (
        <div className="timeline">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <b>{result.code}</b>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{result.items?.length || 0} item(s) · ৳{Number(result.total).toLocaleString("en-IN")}</span>
          </div>
          {result.status === "CANCELLED" || result.status === "RETURNED" ? (
            <div className={"pill " + result.status} style={{ fontSize: 12 }}>{result.status}</div>
          ) : (
            STEPS.map((s, i) => (
              <div className={"tl-step" + (i <= currentIdx ? " done" : "")} key={s}>
                <div className="tl-dot" />
                <div><b>{LABELS[s]}</b>{i === currentIdx && <small>Current status</small>}{i < currentIdx && <small>✓ Done</small>}</div>
              </div>
            ))
          )}
          {result.courierStatus && (
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 12, fontSize: 13, color: "var(--muted)" }}>
              Courier: <b style={{ color: "var(--text)" }}>{result.courierName}</b> · {result.courierStatus}
              {result.courierConsignmentId && <> · Consignment: {result.courierConsignmentId}</>}
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 12, fontSize: 13, color: "var(--muted)" }}>
            Placed {new Date(result.createdAt).toLocaleString("en-GB")}
          </div>
        </div>
      )}
    </div>
  );
}
