"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const TONE: Record<string, string> = { ok: "var(--ok)", warn: "#9a7b1e", bad: "var(--danger)", info: "var(--text)" };

export default function TrackClient() {
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") || sp.get("t") || "");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const lookup = async (c: string) => {
    if (!c.trim()) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/track/courier?code=" + encodeURIComponent(c.trim()));
      const j = await r.json();
      if (r.ok) setResult(j); else setErr(j.error || "Track kora jacche na");
    } catch { setErr("Network error — abar try korun"); }
    setBusy(false);
  };
  useEffect(() => { const c = sp.get("code") || sp.get("t"); if (c) lookup(c); /* eslint-disable-next-line */ }, []);

  return (
    <div className="track-wrap">
      <div className="eyebrow">Order tracking</div>
      <h1 style={{ fontSize: "clamp(28px,3.4vw,38px)", margin: "8px 0 6px" }}>Where&apos;s my parcel?</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 22 }}>
        Tracking number, Consignment ID ba Order code — jekono ekta dilei cholbe.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
        <div className="field">
          <input
            placeholder="e.g. SFR260827ST… ba ORD-1057"
            value={code} onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters" spellCheck={false} aria-label="Tracking number"
            style={{ fontSize: 16, minHeight: 52, letterSpacing: ".04em" }}
          />
        </div>
        <button className="btn" style={{ width: "100%" }} disabled={busy || !code.trim()} type="submit">
          {busy ? "Checking…" : "Track Order"}
        </button>
      </form>

      {err && <div className="noti err" style={{ marginTop: 18 }}>{err}</div>}

      {result && (
        <div className="timeline" style={{ marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <b>{result.code}</b>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {result.createdAt ? new Date(result.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""} · {result.items?.length || 0} item(s)
            </span>
          </div>
          <div style={{ padding: "16px 0", textAlign: "center", borderBottom: "1px solid var(--line)", marginBottom: 14 }}>
            <div style={{ fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)" }}>Current Status</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: TONE[result.tone] || "var(--text)", marginTop: 6 }}>{result.status}</div>
            {result.courierName && (
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
                {result.courierName}{result.consignmentId ? <> · Consignment: <b style={{ color: "var(--text)" }}>{result.consignmentId}</b></> : null}
              </div>
            )}
            {result.notice && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{result.notice}</div>}
          </div>
          <div style={{ fontSize: 13 }}>
            {result.items?.map((i: any, k: number) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "var(--muted)" }}>
                <span>{i.title} × {i.qty}</span>
              </div>
            ))}
          </div>
          {result.source === "steadfast" && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              ● Live status from {result.courierName || "courier"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
