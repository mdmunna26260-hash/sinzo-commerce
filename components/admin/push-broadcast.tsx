"use client";
import { useState } from "react";
import { afetch } from "@/lib/afetch";

type PushStats = { total: number; withPhone: number };

/* Web Push broadcast panel. Lives under Newsletter because that's the
   whole outbound-messaging surface (email + push). Reused verbatim from
   what was previously on the Marketing page — same UI + same API. */
export default function PushBroadcastPanel({ push }: { push: PushStats }) {
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushUrl, setPushUrl] = useState("/");
  const [pushTestPhone, setPushTestPhone] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");

  const sendPush = async (action: "broadcast" | "test") => {
    if (pushBusy) return;
    if (action === "broadcast" && !pushTitle.trim()) { setPushMsg("Title din"); return; }
    if (action === "test" && !pushTestPhone.trim()) { setPushMsg("Test number din"); return; }
    setPushBusy(true); setPushMsg("");
    const r = await afetch("/api/admin/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action, title: pushTitle.trim(), body: pushBody.trim(), url: pushUrl.trim() || "/",
        phone: pushTestPhone.trim(),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setPushBusy(false);
    if (r.ok) {
      setPushMsg("✓ " + (j.detail || "Sent"));
      if (action === "broadcast") { setPushTitle(""); setPushBody(""); }
    } else setPushMsg(j.error || "Failed");
    setTimeout(() => setPushMsg(""), 6000);
  };

  return (
    <div className="acard" style={{ marginTop: 16 }}>
      <div className="acard-h">
        <h3>Push Notifications</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {push?.total || 0} device(s) · {push?.withPhone || 0} linked to phone
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        <div>
          <div className="field af" style={{ marginBottom: 10 }}>
            <label>Title</label>
            <input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="e.g. New Arrival — Winter Collection" maxLength={80} />
          </div>
          <div className="field af" style={{ marginBottom: 10 }}>
            <label>Message</label>
            <textarea value={pushBody} onChange={(e) => setPushBody(e.target.value)} placeholder="Short message (optional)" rows={2} style={{ minHeight: 0, resize: "vertical" }} maxLength={200} />
          </div>
          <div className="field af" style={{ marginBottom: 10 }}>
            <label>Open URL (optional)</label>
            <input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/products" />
          </div>
          <button className="abtn primary" onClick={() => sendPush("broadcast")} disabled={pushBusy} aria-busy={pushBusy || undefined}>
            {pushBusy && <span className="spinner" aria-hidden="true" />}Send to ALL devices
          </button>
        </div>
        <div style={{ borderLeft: "1px solid #eee", paddingLeft: 18 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Kivabe kaj kore: customer order success page theke "Enable" tap korle tar device push subscribe hoy (phone number sathe linked).
            Order status change (CONFIRMED / SHIPPED / DELIVERED / CANCELLED) korle auto push jay. Niche test kore dekhen.
          </div>
          <div className="field af" style={{ marginBottom: 10 }}>
            <label>Test — customer phone</label>
            <input value={pushTestPhone} onChange={(e) => setPushTestPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="numeric" />
          </div>
          <button className="abtn" onClick={() => sendPush("test")} disabled={pushBusy} aria-busy={pushBusy || undefined}>Send test</button>
          {pushMsg && (
            <div style={{ marginTop: 10, fontSize: 13, color: pushMsg.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>
              {pushMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
