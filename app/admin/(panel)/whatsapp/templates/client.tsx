"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useRef, useState } from "react";

/* Template editor. Left: the six automatic events. Right: the text + a live preview rendered with
   sample values from the same renderer the worker uses, so what you see is what the customer gets. */
type Tpl = {
  key: string; name: string; category: string; body: string; mediaMode: string;
  enabled: boolean; updatedAt: string | null; defaults: string; preview: string;
};
type Data = { events: Tpl[]; variables: string[]; siteUrl: string; rules: { enabled: boolean; stopLine: boolean; couponCode: string }; mediaModes?: string[]; maxImages?: number };

export default function WaTemplates() {
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [media, setMedia] = useState("NONE");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [testTo, setTestTo] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    const r = await afetch("/api/admin/whatsapp/templates");
    const j = await r.json().catch(() => ({}));
    if (r.ok) setD(j);
    return j as Data;
  };
  useEffect(() => { load(); }, []);

  const openEditor = (t: Tpl) => {
    setOpen(t.key); setBody(t.body); setName(t.name); setMedia(t.mediaMode);
    setMsg(null);
  };

  const save = async (extra: any = {}) => {
    if (!open) return;
    setBusy("save"); setMsg(null);
    const r = await afetch("/api/admin/whatsapp/templates", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: open, body, name, mediaMode: media, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok || j.ok === false) setMsg({ text: j.error || "Save failed", ok: false });
    else { setMsg({ text: "Save hoyeche ✓", ok: true }); await load(); }
  };

  const toggle = async (t: Tpl) => {
    setBusy("t" + t.key);
    await afetch("/api/admin/whatsapp/templates", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: t.key, enabled: !t.enabled }),
    });
    setBusy(""); await load();
  };

  const testSend = async () => {
    if (!open || !testTo.trim()) return;
    setBusy("test"); setMsg(null);
    const r = await afetch("/api/admin/whatsapp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test", to: testTo.trim(), templateKey: open }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok || j.ok === false) setMsg({ text: j.error || "Test send failed", ok: false });
    else setMsg({ text: "Test pathano hoyeche ✓ — WhatsApp check korun", ok: true });
  };

  const insert = (v: string) => {
    const el = area.current;
    if (!el) { setBody((b) => b + v); return; }
    const start = el.selectionStart ?? body.length;
    const next = body.slice(0, start) + v + body.slice(el.selectionEnd ?? start);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + v.length; });
  };

  if (!d) return <div className="acard"><div className="acard-b">Loading…</div></div>;
  const active = d.events.find((e) => e.key === open) || null;

  return (
    <>
      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 14 }}>{msg.text}</div>}
      {!d.rules.enabled && (
        <div className="noti err" style={{ marginBottom: 14 }}>
          Master switch off — kono automatic message jacche na. <a href="/admin/whatsapp">Queue page</a> theke auto messages ON korun.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Events</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{d.events.filter((e) => e.enabled).length} of {d.events.length} on</span></div>
          <div className="acard-b" style={{ display: "grid", gap: 8 }}>
            {d.events.map((t) => (
              <div key={t.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: open === t.key ? "1px solid var(--accent)" : "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }} onClick={() => openEditor(t)}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {t.key} · {t.mediaMode === "PRODUCT" ? "product photo" : t.mediaMode === "ORDER_ITEMS" ? "up to 3 item photos" : "text only"}{t.updatedAt ? ` · edited ${new Date(t.updatedAt).toLocaleDateString("en-GB")}` : ""}
                  </div>
                </div>
                <button
                  className={"abtn sm" + (t.enabled ? " primary" : "")}
                  disabled={busy === "t" + t.key}
                  onClick={(e) => { e.stopPropagation(); toggle(t); }}
                >
                  {t.enabled ? "ON" : "OFF"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {!active ? (
          <div className="acard"><div className="acard-b" style={{ color: "var(--muted)" }}>Bam dike ekta event select korun — text edit + preview ekhane ashbe.</div></div>
        ) : (
          <div className="acard">
            <div className="acard-h">
              <h3>{active.name}</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{active.key}</span>
            </div>
            <div className="acard-b" style={{ display: "grid", gap: 12 }}>
              <div className="form-grid">
                <div className="af"><label>Label</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="af"><label>Media</label>
                  <select value={media} onChange={(e) => setMedia(e.target.value)}>
                    <option value="NONE">Text only</option>
                    <option value="PRODUCT">Product photo (order-er shera item)</option>
                    <option value="ORDER_ITEMS">Order-er item chhobi (max 3, alada alada)</option>
                  </select>
                </div>
              </div>
              <div className="af">
                <label>Message</label>
                <textarea ref={area} value={body} onChange={(e) => setBody(e.target.value)} rows={12} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {d.variables.map((v) => <button key={v} className="chip" style={{ cursor: "pointer" }} onClick={() => insert(v)}>{v}</button>)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="abtn primary" disabled={busy === "save"} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save template"}</button>
                <button className="abtn" onClick={() => save({ resetToDefault: true })}>Reset to default</button>
                <button className="abtn" onClick={async () => { await save({ enabled: !active.enabled }); }}>{active.enabled ? "Switch OFF" : "Switch ON"}</button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <div className="af" style={{ width: 200 }}><label>Test number</label><input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="01712 345678" inputMode="tel" /></div>
                <button className="abtn" disabled={busy === "test" || !testTo.trim()} onClick={testSend}>{busy === "test" ? "Sending…" : "Send test"}</button>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sample values diye pathano hoy — apnar order lagbe na.</span>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                  Preview — <b>{active.key}</b> (customer ei rokom dekhe{active.mediaMode === "PRODUCT" ? " + product chhobi" : active.mediaMode === "ORDER_ITEMS" ? " + item chhobi (max 3)" : ""})
                </div>
                <div style={{ background: "#e5ded4", padding: 12, borderRadius: 10 }}>
                  <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap", maxWidth: 360, lineHeight: 1.55, boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}>
                    {active.preview || "(khali)"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
