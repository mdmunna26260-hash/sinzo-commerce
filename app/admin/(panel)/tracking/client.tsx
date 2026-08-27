"use client";
import { FmtDate } from "@/components/dates";
import { afetch, withToken } from "@/lib/afetch";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrackingClient({ cfg, events, counts, lastEvent }: any) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ metaPixelId: cfg.metaPixelId, metaAccessToken: cfg.hasMetaToken ? "••••••••" : "", metaTestEventCode: cfg.testEventCode, ga4Id: cfg.ga4Id, gtmId: cfg.gtmId });
  const metaReady = cfg.metaPixelId && cfg.hasMetaToken;

  const save = async () => {
    const r = await afetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: "integrations", value: form }) });
    const j = await r.json();
    setMsg(r.ok ? "Saved ✓ Reload to see status." : j.error || "Failed");
    setTimeout(() => { setMsg(""); if (r.ok) router.refresh(); }, 1200);
  };
  const testCapi = async () => {
    setMsg("Sending test Purchase via CAPI…");
    const r = await afetch("/api/admin/tracking/test", { method: "POST" });
    const j = await r.json();
    if (r.ok) setMsg("✓ Test event sent to Meta successfully — check Events Manager.");
    else if (j.configured === false) setMsg("⚠ NOT CONFIGURED — save Pixel ID + Access Token first.");
    else setMsg("✗ Meta rejected the test event: " + (j.error || "unknown"));
    setTimeout(() => setMsg(""), 6000);
  };

  return (
    <>
      <div className="admin-top"><h1>Tracking &amp; Pixels</h1></div>
      {msg && <div className="noti ok">{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Meta Pixel + Conversions API</h3>
            <span className={"risk-badge " + (metaReady ? "risk-LOW" : "risk-HIGH")}>{metaReady ? "CONFIGURED" : "NOT CONFIGURED"}</span>
          </div>
          <div className="acard-b form-grid">
            <div className="af full"><label>Pixel ID</label><input value={form.metaPixelId} onChange={(e) => setForm({ ...form, metaPixelId: e.target.value })} placeholder="e.g. 123456789012345" /></div>
            <div className="af full"><label>Access Token (CAPI)</label><input value={form.metaAccessToken} onChange={(e) => setForm({ ...form, metaAccessToken: e.target.value })} placeholder="EAAG… (system user token)" /></div>
            <div className="af full"><label>Test Event Code (optional)</label><input value={form.metaTestEventCode} onChange={(e) => setForm({ ...form, metaTestEventCode: e.target.value })} placeholder="TEST12345" /></div>
            <div className="full" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Browser Pixel and server CAPI share the same <code>event_id</code>, so Meta deduplicates events automatically. Events sent: PageView (implicit), ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase, Search, Lead.
            </div>
            <div className="full" style={{ display: "flex", gap: 8 }}>
              <button className="abtn primary" onClick={save}>Save</button>
              <button className="abtn" onClick={testCapi}>Send Test Event</button>
            </div>
          </div>
          <div className="acard-h" style={{ borderTop: "1px solid #eeedea" }}><h3>Google</h3></div>
          <div className="acard-b form-grid">
            <div className="af"><label>GA4 Measurement ID</label><input value={form.ga4Id} onChange={(e) => setForm({ ...form, ga4Id: e.target.value })} placeholder="G-XXXXXXXXXX" /></div>
            <div className="af"><label>GTM Container ID</label><input value={form.gtmId} onChange={(e) => setForm({ ...form, gtmId: e.target.value })} placeholder="GTM-XXXXXXX" /></div>
            <div className="full"><button className="abtn primary" onClick={save}>Save</button></div>
          </div>
        </div>
        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h"><h3>Status</h3></div>
            <div className="acard-b" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
              <div>Meta Pixel: <b style={{ color: cfg.metaPixelId ? "#2e6b4f" : "#b3392f" }}>{cfg.metaPixelId ? "Active" : "Not set"}</b></div>
              <div>Meta CAPI: <b style={{ color: cfg.hasMetaToken ? "#2e6b4f" : "#b3392f" }}>{cfg.hasMetaToken ? "Active" : "Not set"}</b></div>
              <div>GA4: <b style={{ color: cfg.ga4Id ? "#2e6b4f" : "#b3392f" }}>{cfg.ga4Id ? cfg.ga4Id : "Not set"}</b></div>
              <div>GTM: <b style={{ color: cfg.gtmId ? "#2e6b4f" : "#b3392f" }}>{cfg.gtmId ? cfg.gtmId : "Not set"}</b></div>
              <div style={{ gridColumn: "1/-1" }}>Last event: {lastEvent ? <>{lastEvent.name} · {new Date(lastEvent.at).toLocaleString("en-GB")} {lastEvent.ok ? "✓" : "✗"}</> : "—"}</div>
            </div>
          </div>
          <div className="acard">
            <div className="acard-h"><h3>Recent Tracking Events</h3></div>
            <table className="tbl">
              <thead><tr><th>Event</th><th>Source</th><th>Event ID</th><th>Result</th><th>Time</th></tr></thead>
              <tbody>
                {events.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", padding: 24 }}>No events yet — browse the storefront to generate some.</td></tr>}
                {events.map((e: any) => (
                  <tr key={e.id}>
                    <td><b>{e.name}</b></td>
                    <td style={{ fontSize: 12 }}>{e.source}</td>
                    <td style={{ fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{e.eventId || "—"}</td>
                    <td>{e.ok ? <span className="pill DELIVERED">OK</span> : <span title={e.error || ""} className="pill FAILED">ERR</span>}</td>
                    <td style={{ fontSize: 12 }}><FmtDate iso={e.createdAt} mode="time" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
