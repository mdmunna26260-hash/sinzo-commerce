"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useState } from "react";

/* WhatsApp hub client: live queue + delivery rules.
   Polls every 15 s so the owner can start a worker and watch messages move without reloading. */
type Device = { id: number; name: string; phone: string | null; status: string; sentToday: number; dailyCap: number; warmupStage: number; isDefault: boolean; lastError: string | null };
type Msg = {
  id: number; toWaId: string; kind: string; templateKey: string | null; body: string; status: string;
  attempts: number; error: string | null; queuedAt: string; sentAt: string | null; orderId: number | null; meta: string | null;
};
type Stats = { queued: number; sending: number; sent: number; delivered: number; read: number; failed: number; skipped: number; last24h: number; oldestQueuedAt: string | null };
type Rules = {
  enabled: boolean; quietFrom: string; quietTo: string; dailyCapDefault: number; smsFallback: boolean;
  fallbackHours: number; testMode: boolean; testNumber: string; couponCode: string; stopLine: boolean; workerKey: string;
};
type Data = {
  bridgeRunning: boolean; connected: boolean; me: string | null; qrPending: boolean;
  health?: { running: boolean; uptimeSec?: number; sessions?: number; connected?: number };
  devices: Device[]; stats: Stats; recent: Msg[]; templates: { key: string; name: string; enabled: boolean; mediaMode: string }[];
  rules: Rules; defaults: Rules;
};

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const pretty = (waId: string) => (waId || "").replace(/^880/, "0").replace(/\D/g, "");
const meta = (m: Msg) => { try { return JSON.parse(m.meta || "{}") as any; } catch { return {}; } };

const STATUS_PILL: Record<string, string> = {
  QUEUED: "PENDING", SENDING: "PROCESSING", SENT: "SHIPPED", DELIVERED: "DELIVERED", READ: "PAID", FAILED: "FAILED", SKIPPED: "ON_HOLD",
};

export default function WaHub() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testKey, setTestKey] = useState("order_placed");
  const [workerKeyInput, setWorkerKeyInput] = useState("");

  const load = async () => {
    const r = await afetch("/api/admin/whatsapp");
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setD(j); setRules((prev) => prev ?? j.rules); }
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  const act = async (body: any, label: string) => {
    setBusy(label); setMsg(null);
    const r = await afetch("/api/admin/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (body.action === "tick" && j.report) {
      const rep = j.report;
      setMsg({
        ok: true,
        text: `Tick: sent ${rep.sent} · failed ${rep.failed} · retry ${rep.retried} · sms ${rep.smsFallback}${rep.notes?.length ? " · " + rep.notes.join("; ") : ""}`,
      });
    } else if (j.ok) {
      setMsg({ ok: true, text: body.action === "rules" ? "Rules save hoyeche ✓" : body.action === "test" ? "Test message queue-te gelo — worker pathiye dilam ✓" : "Done ✓" });
    } else {
      setMsg({ ok: false, text: j.error || "Failed" });
    }
    if (body.action === "rules" && j.rules) setRules(j.rules);
    load();
  };

  const saveRules = async () => {
    if (!rules) return;
    await act({ action: "rules", value: { ...rules, workerKey: workerKeyInput || rules.workerKey } }, "rules");
  };

  if (!d || !rules) return <div className="acard"><div className="acard-b">Loading…</div></div>;

  const connectedDevices = d.devices.filter((x) => x.status === "CONNECTED");
  const s = d.stats;

  return (
    <>
      {!d.bridgeRunning && (
        <div className="noti err" style={{ marginBottom: 16 }}>
          Bridge cholche na — WhatsApp send hobe na, message gulo queue-te joma thakbe (hariye jabe na).
          VPS/dev machine-e <code>WA_BRIDGE_KEY=… npm run wa</code> chalan.
        </div>
      )}
      {d.bridgeRunning && !connectedDevices.length && (
        <div className="noti err" style={{ marginBottom: 16 }}>
          Kono number connected na — <a href="/admin/whatsapp/devices">Devices</a> page-e giye QR scan korun.
        </div>
      )}
      {d.rules.testMode && (
        <div className="noti" style={{ marginBottom: 16, background: "#fff7e6", borderColor: "#e8c98a" }}>
          <b>Test mode ON</b> — customer-der kache kichu jacche na, shob message {rules.testNumber ? pretty(rules.testNumber) : "(test number set korun)"} e jacche.
        </div>
      )}

      <div className="kpis" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 16 }}>
        <div className="kpi"><div className="k-label">Queue</div><div className="k-val">{s.queued}</div><div className="k-sub">{s.sending ? `${s.sending} sending` : "waiting"}</div></div>
        <div className="kpi"><div className="k-label">Sent (24h)</div><div className="k-val">{s.last24h}</div><div className="k-sub">{s.sent + s.delivered + s.read} total ever</div></div>
        <div className="kpi"><div className="k-label">Delivered</div><div className="k-val">{s.delivered + s.read}</div><div className="k-sub">{s.read} read</div></div>
        <div className="kpi"><div className="k-label">Failed</div><div className="k-val">{s.failed}</div><div className="k-sub">{s.skipped} skipped</div></div>
        <div className="kpi"><div className="k-label">Devices</div><div className="k-val">{connectedDevices.length}/{d.devices.length}</div><div className="k-sub">{d.health?.running ? `bridge up ${d.health.uptimeSec ? Math.round(d.health.uptimeSec / 60) + "m" : ""}` : "bridge down"}</div></div>
        <div className="kpi"><div className="k-label">Oldest in queue</div><div className="k-val" style={{ fontSize: 18 }}>{s.oldestQueuedAt ? when(s.oldestQueuedAt) : "—"}</div><div className="k-sub">30s-er modhye auto jay</div></div>
      </div>

      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 14 }}>{msg.text}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h">
            <h3>Message queue</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="abtn sm" disabled={busy === "tick"} onClick={() => act({ action: "tick", limit: 5 }, "tick")}>{busy === "tick" ? "…" : "Run now"}</button>
              <button className="abtn sm" onClick={load}>Refresh</button>
            </div>
          </div>
          <div className="acard-b" style={{ maxHeight: 560, overflow: "auto" }}>
            {d.recent.length === 0 ? (
              <div style={{ color: "var(--muted)" }}>Queue khali. Order ele ekta row ekhane asbe (order-confirm auto).</div>
            ) : (
              <table className="tbl" style={{ fontSize: 12.5 }}>
                <thead><tr><th>To</th><th>Message</th><th>Status</th><th>Try</th><th>Time</th><th></th></tr></thead>
                <tbody>
                  {d.recent.map((m) => {
                    const mt = meta(m);
                    return (
                      <tr key={m.id}>
                        <td style={{ fontFamily: "ui-monospace, monospace" }}>{pretty(m.toWaId)}{mt.code ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{mt.code}</div> : null}</td>
                        <td style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 600 }}>{m.templateKey || m.kind}{mt.test ? " (test)" : ""}</div>
                          <div style={{ color: "var(--muted)", fontSize: 11.5, whiteSpace: "pre-wrap" }}>{m.body.slice(0, 110)}{m.body.length > 110 ? "…" : ""}</div>
                          {m.error && <div style={{ color: "var(--danger)", fontSize: 11 }}>{m.error.slice(0, 140)}</div>}
                        </td>
                        <td><span className={"pill " + (STATUS_PILL[m.status] || "ON_HOLD")}>{m.status}</span></td>
                        <td>{m.attempts}</td>
                        <td style={{ color: "var(--muted)" }}>{when(m.sentAt || m.queuedAt)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {["FAILED", "SKIPPED"].includes(m.status) && <button className="abtn sm" onClick={() => act({ action: "retry", id: m.id }, "m" + m.id)}>Retry</button>}
                          {["SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"].includes(m.status) && <button className="abtn sm" onClick={() => act({ action: "resend", id: m.id }, "m" + m.id)}>Resend</button>}
                          {["QUEUED", "FAILED"].includes(m.status) && <button className="abtn sm" onClick={() => act({ action: "cancel", id: m.id }, "m" + m.id)}>Cancel</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="acard">
            <div className="acard-h"><h3>Devices</h3><a className="abtn sm" href="/admin/whatsapp/devices">Manage</a></div>
            <div className="acard-b" style={{ display: "grid", gap: 8 }}>
              {d.devices.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>Kono number add kora hoy nai. <a href="/admin/whatsapp/devices">Add your first number</a>.</div>
              ) : d.devices.map((x) => (
                <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{x.name} {x.isDefault && <span style={{ fontSize: 10, color: "var(--muted)" }}>· default</span>}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{x.phone ? pretty(x.phone) : "not paired"} · {x.sentToday}/{x.dailyCap} today</div>
                  </div>
                  <span className={"pill " + (x.status === "CONNECTED" ? "DELIVERED" : x.status === "PAUSED" ? "ON_HOLD" : "FAILED")}>{x.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="acard">
            <div className="acard-h"><h3>Send a test</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>nijer number e</span></div>
            <div className="acard-b" style={{ display: "grid", gap: 10 }}>
              <div className="af"><label>Template</label>
                <select value={testKey} onChange={(e) => setTestKey(e.target.value)}>
                  {d.templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </div>
              <div className="af"><label>Number</label>
                <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="01712 345678" inputMode="tel" />
              </div>
              <button className="abtn primary" disabled={busy === "test" || !testTo.trim()} onClick={() => act({ action: "test", to: testTo.trim(), templateKey: testKey }, "test")}>
                {busy === "test" ? "Sending…" : "Send test now"}
              </button>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Test message e <code>[TEST]</code> lekha thake ar sathe sathe pathano hoy (queue wait kore na)।</div>
            </div>
          </div>

          <div className="acard">
            <div className="acard-h"><h3>Delivery rules</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>ban-safety</span></div>
            <div className="acard-b" style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={rules.enabled} onChange={(e) => setRules({ ...rules, enabled: e.target.checked })} />
                Auto messages ON (off = queue pause, message hariye jay na)
              </label>
              <div className="form-grid">
                <div className="af"><label>Quiet hours from</label><input value={rules.quietFrom} onChange={(e) => setRules({ ...rules, quietFrom: e.target.value })} placeholder="22:00" /></div>
                <div className="af"><label>to</label><input value={rules.quietTo} onChange={(e) => setRules({ ...rules, quietTo: e.target.value })} placeholder="09:00" /></div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                Quiet hours-e <b>marketing/broadcast</b> thake, kintu order update (transactional) shathe shathe jay — customer oi shomoy order koreche.
              </div>
              <div className="form-grid">
                <div className="af"><label>New number daily cap</label><input type="number" min={1} value={rules.dailyCapDefault} onChange={(e) => setRules({ ...rules, dailyCapDefault: Number(e.target.value) })} /></div>
                <div className="af"><label>SMS fallback after (hours)</label><input type="number" min={1} value={rules.fallbackHours} onChange={(e) => setRules({ ...rules, fallbackHours: Number(e.target.value) })} /></div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={rules.smsFallback} onChange={(e) => setRules({ ...rules, smsFallback: e.target.checked })} />
                WhatsApp fail/hold hole SMS diye pathao (SMS gateway configure thakte hobe)
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={rules.stopLine} onChange={(e) => setRules({ ...rules, stopLine: e.target.checked })} />
                Message-er sheshe &ldquo;STOP likhun&rdquo; line din
              </label>
              <div className="form-grid">
                <div className="af"><label>Coupon code (order message-e)</label><input value={rules.couponCode} onChange={(e) => setRules({ ...rules, couponCode: e.target.value })} placeholder="SAVE100 (khali = line jabe na)" /></div>
                <div className="af"><label>Worker key</label><input value={workerKeyInput || rules.workerKey} onChange={(e) => setWorkerKeyInput(e.target.value)} placeholder="Settings-er bridge key-i default" /></div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={rules.testMode} onChange={(e) => setRules({ ...rules, testMode: e.target.checked })} />
                Test mode (shob message test number e)
              </label>
              {rules.testMode && <div className="af"><label>Test number</label><input value={rules.testNumber} onChange={(e) => setRules({ ...rules, testNumber: e.target.value })} placeholder="01712 345678" /></div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="abtn primary" disabled={busy === "rules"} onClick={saveRules}>{busy === "rules" ? "Saving…" : "Save rules"}</button>
                <button className="abtn" onClick={() => { setRules(d.defaults); setWorkerKeyInput(""); }}>Reset form</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        Throughput (default): ekta number-e ~250 message/ghonta (6–12 sec gap, 20–40 er burst, tarpor 3–6 min pause) ·
        daily cap warm-up 50 → 150 → 300 → 400. ৩টা number-e 2000 message ~2h40m–3h,
        ar cap-er karone boro list 1–2 din dhore jay — eta intentional, number ban theke bachate.
      </div>
    </>
  );
}
